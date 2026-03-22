// Azoir — b2b-shopify-webhook Edge Function
// Handles Shopify orders/paid webhook for B2B design fee payments.
// Deploy: npx supabase functions deploy b2b-shopify-webhook --no-verify-jwt
//
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, B2B_SHOPIFY_WEBHOOK_SECRET

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  // ── 1. Read raw body ──────────────────────────────────────────────────────
  const rawBody = await req.text();

  // ── 2. Verify HMAC ────────────────────────────────────────────────────────
  const signature    = req.headers.get("x-shopify-hmac-sha256") ?? "";
  const webhookSecret = Deno.env.get("B2B_SHOPIFY_WEBHOOK_SECRET") ?? "";

  if (!webhookSecret) {
    console.error("B2B_SHOPIFY_WEBHOOK_SECRET not configured");
    return new Response("Webhook secret not configured", { status: 500 });
  }

  const isValid = await verifyHmac(rawBody, signature, webhookSecret);
  if (!isValid) {
    console.warn("Webhook HMAC verification failed");
    return new Response("Unauthorized", { status: 401 });
  }

  // ── 3. Parse order ────────────────────────────────────────────────────────
  let order: Record<string, unknown>;
  try {
    order = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (order.financial_status !== "paid") {
    return new Response("OK — not paid", { status: 200 });
  }

  const shopifyOrderId   = String(order.id);
  const shopifyOrderName = String(order.name ?? "");

  // ── 4. Extract b2b_order_id from line item properties ────────────────────
  let b2bOrderId: string | null = null;
  const lineItems = order.line_items as Array<Record<string, unknown>> ?? [];
  for (const item of lineItems) {
    const props = item.properties as Array<{ name: string; value: string }> ?? [];
    for (const prop of props) {
      if (prop.name === "b2b_order_id" && prop.value) {
        b2bOrderId = prop.value;
        break;
      }
    }
    if (b2bOrderId) break;
  }

  if (!b2bOrderId) {
    // Not a B2B order — ignore
    console.log(`Order ${shopifyOrderId} has no b2b_order_id — skipping`);
    return new Response("OK — not a B2B order", { status: 200 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ── 5. Idempotency check ──────────────────────────────────────────────────
  const { data: existing } = await supabase
    .from("b2b_orders")
    .select("id, design_fee_status")
    .eq("id", b2bOrderId)
    .maybeSingle();

  if (!existing) {
    console.warn(`b2b_order ${b2bOrderId} not found`);
    return new Response("OK — order not found", { status: 200 });
  }

  if (existing.design_fee_status === "paid") {
    console.log(`b2b_order ${b2bOrderId} already paid — skipping`);
    return new Response("OK — already processed", { status: 200 });
  }

  // ── 6. Update b2b_order ───────────────────────────────────────────────────
  const { error: updateErr } = await supabase
    .from("b2b_orders")
    .update({
      design_fee_status:     "paid",
      design_fee_paid_at:    new Date().toISOString(),
      design_fee_payment_ref: shopifyOrderId,
      shopify_order_name:    shopifyOrderName,
      status:                "paid",
    })
    .eq("id", b2bOrderId);

  if (updateErr) {
    console.error("Failed to update b2b_order:", updateErr);
    return new Response("DB error", { status: 500 });
  }

  // ── 7. Record status history ──────────────────────────────────────────────
  await supabase.from("b2b_status_history").insert({
    b2b_order_id: b2bOrderId,
    from_status:  "pending_payment",
    to_status:    "paid",
    changed_by:   "system",
    note:         `Shopify order ${shopifyOrderName} paid`,
  });

  // ── 8. Send internal notification email ──────────────────────────────────
  await sendInternalNotification(b2bOrderId, shopifyOrderName, existing, supabase)
    .catch((e) => console.error("Internal email failed:", e));

  console.log(`B2B order ${b2bOrderId} marked paid — Shopify order ${shopifyOrderName}`);
  return new Response("OK", { status: 200 });
});

// ── Email ─────────────────────────────────────────────────────────────────────

async function sendInternalNotification(
  orderId: string,
  shopifyOrderName: string,
  order: Record<string, unknown>,
  supabase: ReturnType<typeof createClient>,
): Promise<void> {
  // Fetch full order details
  const { data: b2bOrder } = await supabase
    .from("b2b_orders")
    .select("contact_name, company_name, email, metal, stones, notes, quantity, po_number, deadline_at")
    .eq("id", orderId)
    .single();

  const from   = Deno.env.get("EMAIL_FROM") ?? "info@azoir.co";
  const to     = Deno.env.get("INTERNAL_EMAIL") ?? "info@azoir.co";
  const apiKey = Deno.env.get("SENDGRID_API_KEY");
  if (!apiKey || !b2bOrder) return;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:24px;font-family:monospace;font-size:13px;color:#1a1a1a;background:#fff">
  <h2 style="margin:0 0 4px;font-size:18px">B2B DESIGN FEE PAID</h2>
  <p style="margin:0 0 20px;color:#888;font-size:12px">Shopify order ${shopifyOrderName}</p>
  <table style="width:100%;border-collapse:collapse">
    <tr><td style="padding:8px 0;border-bottom:1px solid #eee;width:160px;color:#555">Company</td><td style="padding:8px 0;border-bottom:1px solid #eee"><strong>${esc(b2bOrder.company_name)}</strong></td></tr>
    <tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#555">Contact</td><td style="padding:8px 0;border-bottom:1px solid #eee">${esc(b2bOrder.contact_name)}</td></tr>
    <tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#555">Email</td><td style="padding:8px 0;border-bottom:1px solid #eee">${esc(b2bOrder.email)}</td></tr>
    <tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#555">PO Number</td><td style="padding:8px 0;border-bottom:1px solid #eee">${esc(b2bOrder.po_number ?? '—')}</td></tr>
    <tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#555">Quantity</td><td style="padding:8px 0;border-bottom:1px solid #eee">${b2bOrder.quantity ?? 1}</td></tr>
    <tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#555">Deadline</td><td style="padding:8px 0;border-bottom:1px solid #eee">${esc(b2bOrder.deadline_at ?? '—')}</td></tr>
    <tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#555">Metal</td><td style="padding:8px 0;border-bottom:1px solid #eee">${esc(b2bOrder.metal ?? '—')}</td></tr>
    <tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#555">Stones</td><td style="padding:8px 0;border-bottom:1px solid #eee">${esc(b2bOrder.stones ?? '—')}</td></tr>
    <tr><td style="padding:8px 0;color:#555">Notes</td><td style="padding:8px 0">${esc(b2bOrder.notes ?? '—')}</td></tr>
  </table>
  <p style="margin-top:24px;font-size:11px;color:#888">B2B Order ID: ${orderId}</p>
</body>
</html>`;

  const fromParts = from.match(/^(.+?)\s*<(.+?)>$/);
  const fromObj   = fromParts ? { name: fromParts[1].trim(), email: fromParts[2].trim() } : { email: from };

  await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: fromObj,
      subject: `[B2B PAID] ${b2bOrder.company_name} — ${shopifyOrderName}`,
      content: [{ type: "text/html", value: html }],
    }),
  });
}

function esc(str: string): string {
  return String(str ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

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
    const sig      = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
    const computed = btoa(String.fromCharCode(...new Uint8Array(sig)));
    return computed === signature;
  } catch {
    return false;
  }
}
