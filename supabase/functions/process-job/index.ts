// ─────────────────────────────────────────────────────────────────────────────
// Azoir — Job processor (AI + notifications)
// Called by shopify-payment-webhook after payment is confirmed.
// Deploy: supabase functions deploy process-job --no-verify-jwt
//
// Required env vars:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   PROCESS_JOB_SECRET          — shared secret, must match webhook handler
//   ANTHROPIC_API_KEY
//   RESEND_API_KEY
//   EMAIL_FROM                  — e.g. "Azoir & Co <design@azoir.com>"
//   INTERNAL_EMAIL              — e.g. "design@azoir.com"
//   TWILIO_ACCOUNT_SID          (optional, for SMS/WhatsApp)
//   TWILIO_AUTH_TOKEN           (optional)
//   TWILIO_PHONE_FROM           (optional, for SMS)
//   TWILIO_WHATSAPP_FROM        (optional, for WhatsApp)
// ─────────────────────────────────────────────────────────────────────────────

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { processJob } from "../_shared/job-processor.ts";

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Verify internal secret
  const secret = req.headers.get("x-azoir-secret") ?? "";
  const expected = Deno.env.get("PROCESS_JOB_SECRET") ?? "";

  if (!expected || secret !== expected) {
    return new Response("Unauthorized", { status: 401 });
  }

  let body: { payment_id: string };
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (!body.payment_id) {
    return new Response("payment_id required", { status: 422 });
  }

  // Process in background — respond immediately so webhook doesn't timeout
  processJob(body.payment_id).catch((err) => {
    console.error("processJob error:", err);
  });

  return new Response("OK — processing started", { status: 202 });
});
