// ─────────────────────────────────────────────────────────────────────────────
// Azoir — Shopify orders/paid webhook handler
// Deploy: supabase functions deploy shopify-payment-webhook --no-verify-jwt
//
// Required env vars (Supabase Dashboard → Edge Functions → Secrets):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   SHOPIFY_WEBHOOK_SECRET       — from Shopify Admin → Settings → Notifications → Webhooks
//   PROCESS_JOB_URL              — URL of the process-job Edge Function
//   PROCESS_JOB_SECRET           — shared secret to authorize process-job calls
// ─────────────────────────────────────────────────────────────────────────────

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { ShopifyOrder } from "../_shared/types.ts";

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // ── 1. Read raw body (needed for HMAC verification) ──────────────────────
  const rawBody = await req.text();

  // ── 2. Verify Shopify HMAC signature ─────────────────────────────────────
  const signature = req.headers.get("x-shopify-hmac-sha256") ?? "";
  const webhookSecret = Deno.env.get("SHOPIFY_WEBHOOK_SECRET") ?? "";

  if (!webhookSecret) {
    console.error("SHOPIFY_WEBHOOK_SECRET not configured");
    return new Response("Webhook secret not configured", { status: 500 });
  }

  const isValid = await verifyHmac(rawBody, signature, webhookSecret);
  if (!isValid) {
    console.warn("Webhook HMAC verification failed");
    return new Response("Unauthorized", { status: 401 });
  }

  // ── 3. Parse order payload ────────────────────────────────────────────────
  let order: ShopifyOrder;
  try {
    order = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  // Only process paid orders
  if (order.financial_status !== "paid") {
    return new Response("OK — not a paid event", { status: 200 });
  }

  const shopifyOrderId = String(order.id);

  // ── 4. Extract request_id from line item properties ───────────────────────
  let requestId: string | null = null;
  for (const item of order.line_items ?? []) {
    for (const prop of item.properties ?? []) {
      if (prop.name === "request_id" && prop.value) {
        requestId = prop.value;
        break;
      }
    }
    if (requestId) break;
  }

  // Also check order note_attributes as fallback
  if (!requestId) {
    for (const attr of order.note_attributes ?? []) {
      if (attr.name === "request_id" && attr.value) {
        requestId = attr.value;
        break;
      }
    }
  }

  if (!requestId) {
    // Not an Azoir design fee order — ignore silently
    console.log(`Order ${shopifyOrderId} has no request_id — skipping`);
    return new Response("OK — no request_id", { status: 200 });
  }

  // ── 5. Supabase client ────────────────────────────────────────────────────
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ── 6. Idempotency check — skip if already processed ─────────────────────
  const { data: existing } = await supabase
    .from("payments")
    .select("id")
    .eq("shopify_order_id", shopifyOrderId)
    .maybeSingle();

  if (existing) {
    console.log(`Order ${shopifyOrderId} already processed — skipping`);
    return new Response("OK — already processed", { status: 200 });
  }

  // ── 7. Record payment ─────────────────────────────────────────────────────
  const { data: payment, error: payErr } = await supabase
    .from("payments")
    .insert({
      quote_request_id:   requestId,
      shopify_order_id:   shopifyOrderId,
      shopify_order_name: order.name,
      amount:             parseFloat(order.total_price) || 59,
      currency:           order.currency ?? "AUD",
      status:             "captured",
      raw_payload:        order,
    })
    .select("id")
    .single();

  if (payErr || !payment) {
    console.error("Failed to insert payment:", payErr);
    await logEvent(supabase, {
      quote_request_id: requestId,
      event: "payment_insert_failed",
      level: "error",
      message: payErr?.message,
    });
    return new Response("DB error", { status: 500 });
  }

  const paymentId = payment.id as string;

  // ── 8. Update quote_requests status ──────────────────────────────────────
  await supabase
    .from("quote_requests")
    .update({
      design_fee_status:      "paid",
      design_fee_paid_at:     new Date().toISOString(),
      design_fee_payment_ref: shopifyOrderId,
      status:                 "paid",
    })
    .eq("id", requestId);

  // ── 9. Create job record ──────────────────────────────────────────────────
  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .insert({
      payment_id:       paymentId,
      quote_request_id: requestId,
      status:           "new",
    })
    .select("id, job_ref")
    .single();

  if (jobErr || !job) {
    console.error("Failed to insert job:", jobErr);
    await logEvent(supabase, {
      quote_request_id: requestId,
      payment_id:       paymentId,
      event:            "job_insert_failed",
      level:            "error",
      message:          jobErr?.message,
    });
    // Return 200 so Shopify doesn't retry — payment is recorded, job can be created manually
    return new Response("OK — payment recorded, job creation failed", { status: 200 });
  }

  await logEvent(supabase, {
    quote_request_id: requestId,
    payment_id:       paymentId,
    job_id:           job.id,
    event:            "webhook_processed",
    message:          `Order ${order.name} — Job ${job.job_ref} created`,
  });

  // ── 10. Fire process-job asynchronously (fire and forget) ─────────────────
  const processJobUrl    = Deno.env.get("PROCESS_JOB_URL");
  const processJobSecret = Deno.env.get("PROCESS_JOB_SECRET");

  if (processJobUrl) {
    // Don't await — let it run in background after we respond to Shopify
    fetch(processJobUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-azoir-secret": processJobSecret ?? "",
      },
      body: JSON.stringify({ payment_id: paymentId }),
    }).catch((err) => console.error("process-job trigger failed:", err));
  }

  return new Response("OK", { status: 200 });
});

// ── HMAC verification ─────────────────────────────────────────────────────────

async function verifyHmac(body: string, signature: string, secret: string): Promise<boolean> {
  if (!signature) return false;
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
    const computed = btoa(String.fromCharCode(...new Uint8Array(sig)));
    return computed === signature;
  } catch {
    return false;
  }
}

// ── Log helper ────────────────────────────────────────────────────────────────

async function logEvent(
  supabase: ReturnType<typeof createClient>,
  entry: {
    quote_request_id?: string;
    payment_id?: string;
    job_id?: string;
    event: string;
    level?: string;
    message?: string;
  },
) {
  await supabase.from("processing_logs").insert({
    quote_request_id: entry.quote_request_id ?? null,
    payment_id:       entry.payment_id ?? null,
    job_id:           entry.job_id ?? null,
    event:            entry.event,
    level:            entry.level ?? "info",
    message:          entry.message ?? null,
  });
}
