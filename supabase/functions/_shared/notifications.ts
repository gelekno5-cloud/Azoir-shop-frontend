// ─────────────────────────────────────────────────────────────────────────────
// Azoir — Notification router
// Routes customer confirmation to the right channel based on contact_method.
// Always sends the internal job sheet email regardless of channel.
// ─────────────────────────────────────────────────────────────────────────────

import { sendCustomerEmail, sendInternalJobSheet } from "./email.ts";
import { sendSms } from "./sms.ts";
import { sendWhatsApp } from "./whatsapp.ts";
import type { QuoteRequest, NotificationChannel } from "./types.ts";

export interface NotifyResult {
  channel: NotificationChannel;
  recipient: string;
  providerId: string | null;
  error: string | null;
  sentAt: string | null;
}

export interface NotifyAllResult {
  customer: NotifyResult;
  internal: NotifyResult;
}

// ── Send customer confirmation + internal job sheet ───────────────────────────

export async function notifyAll(
  quote: QuoteRequest,
  jobRef: string,
  jobId: string,
  customerMessage: string,
  jobSheetContent: string,
): Promise<NotifyAllResult> {
  const channel = resolveChannel(quote.contact_method);

  const [customerResult, internalResult] = await Promise.all([
    notifyCustomer(quote, jobRef, channel, customerMessage),
    notifyInternal(jobRef, jobId, jobSheetContent, quote.id),
  ]);

  return { customer: customerResult, internal: internalResult };
}

// ── Customer notification ─────────────────────────────────────────────────────

async function notifyCustomer(
  quote: QuoteRequest,
  jobRef: string,
  channel: NotificationChannel,
  message: string,
): Promise<NotifyResult> {
  const now = new Date().toISOString();

  if (channel === "email") {
    const result = await sendCustomerEmail(quote.email, quote.customer_name, jobRef, message);
    return {
      channel: "email",
      recipient: quote.email,
      providerId: result.id,
      error: result.error,
      sentAt: result.error ? null : now,
    };
  }

  if (channel === "sms") {
    const phone = quote.phone;
    if (!phone) {
      return { channel: "sms", recipient: "", providerId: null, error: "No phone number on record", sentAt: null };
    }
    const result = await sendSms(phone, message);
    return {
      channel: "sms",
      recipient: phone,
      providerId: result.sid,
      error: result.error,
      sentAt: result.error ? null : now,
    };
  }

  if (channel === "whatsapp") {
    const phone = quote.phone;
    if (!phone) {
      // Fall back to email if no phone
      const result = await sendCustomerEmail(quote.email, quote.customer_name, jobRef, message);
      return {
        channel: "email",
        recipient: quote.email,
        providerId: result.id,
        error: result.error,
        sentAt: result.error ? null : now,
      };
    }
    const result = await sendWhatsApp(phone, message);
    return {
      channel: "whatsapp",
      recipient: phone,
      providerId: result.sid,
      error: result.error,
      sentAt: result.error ? null : now,
    };
  }

  // Fallback — always email
  const result = await sendCustomerEmail(quote.email, quote.customer_name, jobRef, message);
  return {
    channel: "email",
    recipient: quote.email,
    providerId: result.id,
    error: result.error,
    sentAt: result.error ? null : new Date().toISOString(),
  };
}

// ── Internal job sheet ────────────────────────────────────────────────────────

async function notifyInternal(
  jobRef: string,
  jobId: string,
  jobSheetContent: string,
  quoteId: string,
): Promise<NotifyResult> {
  const internalEmail = Deno.env.get("INTERNAL_EMAIL") ?? "design@azoir.com";
  const result = await sendInternalJobSheet(jobRef, jobSheetContent, quoteId);
  return {
    channel: "email",
    recipient: internalEmail,
    providerId: result.id,
    error: result.error,
    sentAt: result.error ? null : new Date().toISOString(),
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveChannel(contactMethod: string | null): NotificationChannel {
  if (contactMethod === "sms") return "sms";
  if (contactMethod === "whatsapp") return "whatsapp";
  return "email";
}
