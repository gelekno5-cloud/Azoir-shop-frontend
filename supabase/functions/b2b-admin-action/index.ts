// Azoir — b2b-admin-action Edge Function
// Approve or reject a B2B registration. Updates Supabase + Shopify customer tags + sends email.
// Deploy: npx supabase functions deploy b2b-admin-action --no-verify-jwt

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { customerHasTag, addCustomerTag, removeCustomerTag } from "../_shared/shopify-admin.ts";

const ALLOWED_ORIGINS = Deno.env.get("ALLOWED_ORIGINS") ?? "*";

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGINS,
  "Access-Control-Allow-Headers": "content-type, x-admin-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Simple secret to protect this endpoint — set ADMIN_ACTION_SECRET in Supabase secrets
const ADMIN_SECRET = Deno.env.get("ADMIN_ACTION_SECRET") ?? "";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);

  // Auth check
  const secret = req.headers.get("x-admin-secret");
  if (!ADMIN_SECRET || secret !== ADMIN_SECRET) {
    return json({ success: false, error: "Unauthorized" }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const registration_id = sanitize(body.registration_id);
  const action          = sanitize(body.action);          // "approve" | "reject"
  const reviewed_by     = sanitize(body.reviewed_by);     // admin shopify_customer_id
  const rejection_reason = sanitize(body.rejection_reason);
  const internal_notes  = sanitize(body.internal_notes);

  if (!registration_id) return json({ success: false, error: "registration_id is required" }, 422);
  if (!action || !["approve", "reject"].includes(action)) {
    return json({ success: false, error: "action must be 'approve' or 'reject'" }, 422);
  }
  if (action === "reject" && !rejection_reason) {
    return json({ success: false, error: "rejection_reason is required when rejecting" }, 422);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Fetch registration
  const { data: reg, error: fetchErr } = await supabase
    .from("b2b_registrations")
    .select("*")
    .eq("id", registration_id)
    .single();

  if (fetchErr || !reg) {
    return json({ success: false, error: "Registration not found" }, 404);
  }

  if (reg.status === "approved" && action === "approve") {
    return json({ success: false, error: "Already approved" }, 409);
  }

  const newStatus = action === "approve" ? "approved" : "rejected";

  // Update DB
  const { error: updateErr } = await supabase
    .from("b2b_registrations")
    .update({
      status:           newStatus,
      reviewed_at:      new Date().toISOString(),
      reviewed_by:      reviewed_by ?? null,
      rejection_reason: action === "reject" ? (rejection_reason ?? null) : null,
      internal_notes:   internal_notes ?? reg.internal_notes,
    })
    .eq("id", registration_id);

  if (updateErr) {
    console.error("DB update error:", updateErr);
    return json({ success: false, error: "Failed to update registration" }, 500);
  }

  // Update Shopify customer tags
  try {
    if (action === "approve") {
      await addCustomerTag(reg.shopify_customer_id, "b2b-approved");
      await removeCustomerTag(reg.shopify_customer_id, "b2b-pending");
    } else {
      await removeCustomerTag(reg.shopify_customer_id, "b2b-approved");
      await removeCustomerTag(reg.shopify_customer_id, "b2b-pending");
    }
  } catch (tagErr) {
    // Log but don't fail — DB is source of truth
    console.error("Shopify tag update failed:", tagErr);
  }

  // Send email to applicant
  await sendDecisionEmail(
    reg.email,
    reg.contact_name,
    reg.company_name,
    action,
    rejection_reason,
  ).catch((e) => console.error("Decision email failed:", e));

  return json({ success: true, status: newStatus }, 200);
});

// ── Email ─────────────────────────────────────────────────────────────────────

async function sendDecisionEmail(
  to: string,
  name: string,
  company: string,
  action: string,
  rejectionReason: string | undefined,
): Promise<void> {
  const from    = Deno.env.get("EMAIL_FROM") ?? "info@azoir.co";
  const apiKey  = Deno.env.get("SENDGRID_API_KEY");
  if (!apiKey) return;

  const firstName = name.split(" ")[0];
  const isApproved = action === "approve";

  const subject = isApproved
    ? "Your Azoir trade account is approved"
    : "Your Azoir trade application — update";

  const bodyHtml = isApproved
    ? `<p style="margin:0 0 16px;line-height:1.6">Great news — your trade account for <strong>${company}</strong> has been approved. You now have access to our B2B commission portal.</p>
       <p style="margin:0 0 24px;line-height:1.6">Log in to your account and visit the <a href="https://azoir-co.myshopify.com/pages/b2b-commission" style="color:#0a0a0a">B2B Commission page</a> to get started.</p>`
    : `<p style="margin:0 0 16px;line-height:1.6">Thank you for your interest in the Azoir & Co trade programme. After reviewing your application for <strong>${company}</strong>, we're unable to approve it at this time.</p>
       ${rejectionReason ? `<p style="margin:0 0 16px;line-height:1.6"><strong>Reason:</strong> ${rejectionReason}</p>` : ""}
       <p style="margin:0 0 16px;line-height:1.6">If you have questions or believe this is an error, please contact us at <a href="mailto:info@azoir.co" style="color:#0a0a0a">info@azoir.co</a>.</p>`;

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
            <p style="margin:6px 0 0;color:rgba(255,255,255,0.5);font-size:11px;letter-spacing:0.2em;font-family:sans-serif;text-transform:uppercase">Trade Partner Programme</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px 40px 32px;color:#1a1a1a;font-size:15px">
            <p style="margin:0 0 24px;font-size:17px">Dear ${firstName},</p>
            ${bodyHtml}
          </td>
        </tr>
        ${isApproved ? `<tr>
          <td style="padding:0 40px 32px">
            <a href="https://azoir-co.myshopify.com/pages/b2b-commission"
              style="display:inline-block;background:#0a0a0a;color:#fff;padding:14px 28px;text-decoration:none;border-radius:4px;font-family:sans-serif;font-size:14px;letter-spacing:0.05em">
              Go to B2B Commission Portal
            </a>
          </td>
        </tr>` : ""}
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
      subject,
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
