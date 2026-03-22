// Azoir — b2b-register Edge Function
// Receives B2B registration form POST, saves to b2b_registrations, sends emails.
// Deploy: npx supabase functions deploy b2b-register --no-verify-jwt

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = Deno.env.get("ALLOWED_ORIGINS") ?? "*";

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGINS,
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: "Invalid JSON body" }, 400);
  }

  // Required fields
  const shopify_customer_id = sanitize(body.shopify_customer_id);
  const contact_name        = sanitize(body.contact_name);
  const company_name        = sanitize(body.company_name);
  const email               = sanitize(body.email);

  if (!shopify_customer_id) return json({ success: false, error: "shopify_customer_id is required" }, 422);
  if (!contact_name)        return json({ success: false, error: "contact_name is required" }, 422);
  if (!company_name)        return json({ success: false, error: "company_name is required" }, 422);
  if (!email)               return json({ success: false, error: "email is required" }, 422);
  if (!isValidEmail(email)) return json({ success: false, error: "Invalid email address" }, 422);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Check for existing registration
  const { data: existing } = await supabase
    .from("b2b_registrations")
    .select("id, status")
    .eq("shopify_customer_id", shopify_customer_id)
    .maybeSingle();

  if (existing) {
    if (existing.status === "approved") {
      return json({ success: false, error: "already_approved" }, 409);
    }
    if (existing.status === "pending") {
      return json({ success: false, error: "already_pending" }, 409);
    }
    // rejected — allow re-application by updating existing row
  }

  const row = {
    shopify_customer_id,
    contact_name,
    company_name,
    email,
    phone:                   sanitize(body.phone)                   ?? null,
    website:                 sanitize(body.website)                 ?? null,
    business_type:           sanitize(body.business_type)           ?? null,
    country:                 sanitize(body.country)                 ?? null,
    tax_id:                  sanitize(body.tax_id)                  ?? null,
    resale_cert_url:         sanitize(body.resale_cert_url)         ?? null,
    resale_cert_expires_at:  sanitize(body.resale_cert_expires_at)  ?? null,
    status:                  "pending",
    reviewed_at:             null,
    reviewed_by:             null,
    rejection_reason:        null,
  };

  let registrationId: string;

  if (existing) {
    // Re-application after rejection
    const { data, error } = await supabase
      .from("b2b_registrations")
      .update(row)
      .eq("id", existing.id)
      .select("id")
      .single();

    if (error) {
      console.error("DB update error:", error);
      return json({ success: false, error: "Failed to save registration." }, 500);
    }
    registrationId = data.id;
  } else {
    const { data, error } = await supabase
      .from("b2b_registrations")
      .insert(row)
      .select("id")
      .single();

    if (error) {
      console.error("DB insert error:", error);
      return json({ success: false, error: "Failed to save registration." }, 500);
    }
    registrationId = data.id;
  }

  // Send emails (non-blocking — don't fail the request if email fails)
  await Promise.allSettled([
    sendApplicantEmail(email, contact_name, company_name),
    sendInternalNotification(registrationId, contact_name, company_name, email, sanitize(body.business_type)),
  ]);

  return json({ success: true, registration_id: registrationId }, 200);
});

// ── Email helpers ─────────────────────────────────────────────────────────────

async function sendApplicantEmail(to: string, name: string, company: string): Promise<void> {
  const from          = Deno.env.get("EMAIL_FROM") ?? "info@azoir.co";
  const firstName     = name.split(" ")[0];
  const apiKey        = Deno.env.get("SENDGRID_API_KEY");
  if (!apiKey) return;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f4f0;font-family:Georgia,serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f4f0;padding:40px 16px">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:4px;overflow:hidden">
        <tr>
          <td style="background:#0a0a0a;padding:32px 40px;text-align:center">
            <p style="margin:0;color:#fff;font-family:Georgia,serif;font-size:22px;letter-spacing:0.12em">AZOIR & CO</p>
            <p style="margin:6px 0 0;color:rgba(255,255,255,0.5);font-size:11px;letter-spacing:0.2em;font-family:sans-serif;text-transform:uppercase">Trade Partner Application</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px 40px 32px;color:#1a1a1a;font-size:15px">
            <p style="margin:0 0 16px;font-size:17px">Dear ${firstName},</p>
            <p style="margin:0 0 16px;line-height:1.6">Thank you for applying to become an Azoir & Co trade partner. We have received your application for <strong>${company}</strong> and our team will review it shortly.</p>
            <p style="margin:0 0 16px;line-height:1.6">We typically respond within 1–2 business days. You'll receive an email once your application has been reviewed.</p>
            <p style="margin:0;line-height:1.6">In the meantime, if you have any questions please don't hesitate to reach out at <a href="mailto:info@azoir.co" style="color:#0a0a0a">info@azoir.co</a>.</p>
          </td>
        </tr>
        <tr>
          <td style="background:#f5f4f0;padding:24px 40px;text-align:center;color:#888;font-size:11px;font-family:sans-serif">
            <p style="margin:0">© Azoir & Co · <a href="mailto:info@azoir.co" style="color:#888">info@azoir.co</a></p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
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
      subject: "Trade partner application received — Azoir & Co",
      content: [{ type: "text/html", value: html }],
    }),
  });
}

async function sendInternalNotification(
  id: string,
  name: string,
  company: string,
  email: string,
  businessType: string | undefined,
): Promise<void> {
  const from        = Deno.env.get("EMAIL_FROM") ?? "info@azoir.co";
  const to          = Deno.env.get("INTERNAL_EMAIL") ?? "info@azoir.co";
  const apiKey      = Deno.env.get("SENDGRID_API_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  if (!apiKey) return;

  const adminUrl = `${supabaseUrl.replace("supabase.co", "supabase.com")}/project/avmcksqllodvspbtcmgf/editor`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:24px;font-family:monospace;font-size:13px;color:#1a1a1a;background:#fff">
  <h2 style="margin:0 0 16px;font-size:18px">NEW B2B APPLICATION</h2>
  <table style="width:100%;border-collapse:collapse">
    <tr><td style="padding:8px 0;border-bottom:1px solid #eee;width:160px;color:#555">Name</td><td style="padding:8px 0;border-bottom:1px solid #eee"><strong>${name}</strong></td></tr>
    <tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#555">Company</td><td style="padding:8px 0;border-bottom:1px solid #eee"><strong>${company}</strong></td></tr>
    <tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#555">Email</td><td style="padding:8px 0;border-bottom:1px solid #eee">${email}</td></tr>
    <tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#555">Business type</td><td style="padding:8px 0;border-bottom:1px solid #eee">${businessType ?? "—"}</td></tr>
    <tr><td style="padding:8px 0;color:#555">Registration ID</td><td style="padding:8px 0;font-family:monospace;font-size:11px">${id}</td></tr>
  </table>
  <p style="margin-top:24px"><a href="https://azoir-co.myshopify.com/admin/pages/b2b-admin" style="background:#0a0a0a;color:#fff;padding:10px 20px;text-decoration:none;border-radius:4px;font-family:sans-serif;font-size:13px">Review in Admin Dashboard</a></p>
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
      subject: `[B2B APPLICATION] ${company} — ${name}`,
      content: [{ type: "text/html", value: html }],
    }),
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function sanitize(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  return v.trim().slice(0, 2000) || undefined;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
