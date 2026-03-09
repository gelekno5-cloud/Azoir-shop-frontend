// ─────────────────────────────────────────────────────────────────────────────
// Azoir — Job processor pipeline
// Called by process-job Edge Function after a payment is confirmed.
// 1. Fetch submission from quote_requests
// 2. Generate AI job sheet + customer confirmation
// 3. Send notifications
// 4. Record everything in DB
// ─────────────────────────────────────────────────────────────────────────────

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateJobSheet, generateCustomerConfirmation } from "./ai.ts";
import { notifyAll } from "./notifications.ts";
import type { QuoteRequest, NotificationChannel } from "./types.ts";

export async function processJob(paymentId: string): Promise<void> {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  await log(supabase, { payment_id: paymentId, event: "process_job_start", message: "Starting job processing" });

  try {
    // 1. Fetch payment + job records
    const { data: payment, error: payErr } = await supabase
      .from("payments")
      .select("*, jobs(id, job_ref, quote_request_id)")
      .eq("id", paymentId)
      .single();

    if (payErr || !payment) throw new Error(`Payment not found: ${payErr?.message}`);

    const job = payment.jobs?.[0];
    if (!job) throw new Error(`No job record for payment ${paymentId}`);

    const jobId   = job.id as string;
    const jobRef  = job.job_ref as string;
    const quoteId = job.quote_request_id as string;

    // 2. Fetch quote submission
    const { data: quote, error: quoteErr } = await supabase
      .from("quote_requests")
      .select("*")
      .eq("id", quoteId)
      .single();

    if (quoteErr || !quote) throw new Error(`Quote not found: ${quoteErr?.message}`);

    const paidAt = new Date(payment.created_at).toLocaleDateString("en-AU", {
      day: "numeric", month: "long", year: "numeric",
    });

    // 3. Generate AI outputs in parallel
    const channel = resolveChannel(quote.contact_method);

    await log(supabase, { payment_id: paymentId, job_id: jobId, event: "ai_start", message: "Generating AI outputs" });

    const [jobSheetResult, confirmationResult] = await Promise.all([
      generateJobSheet(quote as QuoteRequest, jobRef, paidAt),
      generateCustomerConfirmation(quote as QuoteRequest, jobRef, channel),
    ]);

    // 4. Save AI outputs
    await supabase.from("ai_outputs").insert([
      {
        job_id: jobId,
        output_type: "job_sheet",
        model: jobSheetResult.model,
        prompt_tokens: jobSheetResult.promptTokens,
        output_tokens: jobSheetResult.outputTokens,
        content: jobSheetResult.content,
      },
      {
        job_id: jobId,
        output_type: "customer_confirmation",
        model: confirmationResult.model,
        prompt_tokens: confirmationResult.promptTokens,
        output_tokens: confirmationResult.outputTokens,
        content: confirmationResult.content,
      },
    ]);

    await log(supabase, { payment_id: paymentId, job_id: jobId, event: "ai_complete", message: "AI outputs generated" });

    // 5. Send notifications
    const notifyResult = await notifyAll(
      quote as QuoteRequest,
      jobRef,
      jobId,
      confirmationResult.content,
      jobSheetResult.content,
    );

    // 6. Record notification results
    const notifRows = [
      {
        job_id: jobId,
        channel: notifyResult.customer.channel,
        recipient: notifyResult.customer.recipient,
        status: notifyResult.customer.error ? "failed" : "sent",
        provider_id: notifyResult.customer.providerId,
        error_message: notifyResult.customer.error,
        sent_at: notifyResult.customer.sentAt,
      },
      {
        job_id: jobId,
        channel: notifyResult.internal.channel,
        recipient: notifyResult.internal.recipient,
        status: notifyResult.internal.error ? "failed" : "sent",
        provider_id: notifyResult.internal.providerId,
        error_message: notifyResult.internal.error,
        sent_at: notifyResult.internal.sentAt,
      },
    ];
    await supabase.from("notifications").insert(notifRows);

    // 7. Update job status
    await supabase.from("jobs").update({ status: "in_progress" }).eq("id", jobId);

    await log(supabase, {
      payment_id: paymentId,
      job_id: jobId,
      event: "process_job_complete",
      message: "Job processing complete",
      metadata: {
        customer_channel: notifyResult.customer.channel,
        customer_sent: !notifyResult.customer.error,
        internal_sent: !notifyResult.internal.error,
      },
    });
  } catch (err) {
    await log(supabase, {
      payment_id: paymentId,
      event: "process_job_error",
      level: "error",
      message: String(err),
    });
    throw err;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveChannel(contactMethod: string | null): "email" | "sms" | "whatsapp" {
  if (contactMethod === "sms") return "sms";
  if (contactMethod === "whatsapp") return "whatsapp";
  return "email";
}

async function log(
  supabase: SupabaseClient,
  entry: {
    quote_request_id?: string;
    payment_id?: string;
    job_id?: string;
    event: string;
    level?: string;
    message?: string;
    metadata?: Record<string, unknown>;
  },
) {
  await supabase.from("processing_logs").insert({
    quote_request_id: entry.quote_request_id ?? null,
    payment_id: entry.payment_id ?? null,
    job_id: entry.job_id ?? null,
    event: entry.event,
    level: entry.level ?? "info",
    message: entry.message ?? null,
    metadata: entry.metadata ?? null,
  });
}
