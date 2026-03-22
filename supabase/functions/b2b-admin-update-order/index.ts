// Azoir — b2b-admin-update-order Edge Function
// Advances B2B order status, records history, sends customer email.
// Deploy: npx supabase functions deploy b2b-admin-update-order --no-verify-jwt

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = Deno.env.get("ALLOWED_ORIGINS") ?? "*";
const ADMIN_SECRET    = Deno.env.get("ADMIN_ACTION_SECRET") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGINS,
  "Access-Control-Allow-Headers": "content-type, x-admin-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const VALID_TRANSITIONS: Record<string, string[]> = {
  paid:           ["in_design", "cancelled"],
  in_design:      ["in_production", "cancelled"],
  in_production:  ["shipped", "cancelled"],
  shipped:        ["complete", "cancelled"],
  complete:       [],
  cancelled:      [],
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);

  const secret = req.headers.get("x-admin-secret");
  if (!ADMIN_SECRET || secret !== ADMIN_SECRET) return json({ success: false, error: "Unauthorized" }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return json({ success: false, error: "Invalid JSON body" }, 400); }

  const order_id       = sanitize(body.order_id);
  const new_status     = sanitize(body.new_status);
  const changed_by     = sanitize(body.changed_by);
  const note           = sanitize(body.note);
  const tracking_number  = sanitize(body.tracking_number);
  const tracking_carrier = sanitize(body.tracking_carrier);

  if (!order_id)   return json({ success: false, error: "order_id is required" }, 422);
  if (!new_status) return json({ success: false, error: "new_status is required" }, 422);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Fetch order
  const { data: order, error: fetchErr } = await supabase
    .from("b2b_orders")
    .select("*")
    .eq("id", order_id)
    .single();

  if (fetchErr || !order) return json({ success: false, error: "Order not found" }, 404);

  // Validate transition
  const allowed = VALID_TRANSITIONS[order.status] ?? [];
  if (!allowed.includes(new_status)) {
    return json({
      success: false,
      error: `Cannot transition from '${order.status}' to '${new_status}'`,
    }, 422);
  }

  if (new_status === "shipped" && !tracking_number) {
    return json({ success: false, error: "tracking_number is required when marking as shipped" }, 422);
  }

  // Build update payload
  const updates: Record<string, unknown> = { status: new_status };
  if (new_status === "shipped") {
    updates.tracking_number  = tracking_number ?? null;
    updates.tracking_carrier = tracking_carrier ?? null;
    updates.shipped_at       = new Date().toISOString();
  }

  const { error: updateErr } = await supabase
    .from("b2b_orders")
    .update(updates)
    .eq("id", order_id);

  if (updateErr) {
    console.error("DB update error:", updateErr);
    return json({ success: false, error: "Failed to update order" }, 500);
  }

  // Record status history
  await supabase.from("b2b_status_history").insert({
    b2b_order_id: order_id,
    from_status:  order.status,
    to_status:    new_status,
    changed_by:   changed_by ?? "admin",
    note:         note ?? null,
  });

  // Send customer email
  await sendStatusEmail(order, new_status, note, tracking_number, tracking_carrier)
    .catch(e => console.error("Status email failed:", e));

  return json({ success: true, status: new_status }, 200);
});

// ── Email ─────────────────────────────────────────────────────────────────────

async function sendStatusEmail(
  order: Record<string, unknown>,
  newStatus: string,
  note: string | undefined,
  trackingNumber: string | undefined,
  trackingCarrier: string | undefined,
): Promise<void> {
  const from   = Deno.env.get("EMAIL_FROM") ?? "info@azoir.co";
  const apiKey = Deno.env.get("SENDGRID_API_KEY");
  if (!apiKey) return;

  const to        = order.email as string;
  const firstName = (order.contact_name as string ?? "").split(" ")[0];

  const subjects: Record<string, string> = {
    in_design:     "Your B2B order is now in design",
    in_production: "Your B2B order is in production",
    shipped:       "Your order has been shipped",
    complete:      "Your B2B order is complete",
    cancelled:     "Your B2B order has been cancelled",
  };

  const subject = subjects[newStatus] ?? `B2B order update — ${newStatus}`;

  const bodyMap: Record<string, string> = {
    in_design: `<p style="margin:0 0 16px;line-height:1.6">Great news — we've started the design phase for your commission. Our team is working on concepts based on your brief.</p>
      <p style="margin:0;line-height:1.6">We'll be in touch as soon as the designs are ready for your review.</p>`,

    in_production: `<p style="margin:0 0 16px;line-height:1.6">Your approved design has moved into production. Our craftsmen are now working on your piece${(order.quantity as number) > 1 ? 's' : ''}.</p>
      <p style="margin:0;line-height:1.6">We'll notify you once your order has shipped.</p>`,

    shipped: `<p style="margin:0 0 16px;line-height:1.6">Your order is on its way!</p>
      ${trackingNumber ? `<div style="background:#f5f4f0;border-left:3px solid #0a0a0a;padding:14px 20px;margin:0 0 16px;border-radius:0 4px 4px 0">
        <p style="margin:0;font-size:11px;letter-spacing:0.15em;color:#888;font-family:sans-serif;text-transform:uppercase">Tracking</p>
        <p style="margin:4px 0 0;font-size:16px;font-weight:bold;font-family:monospace">${esc(trackingNumber)}</p>
        ${trackingCarrier ? `<p style="margin:4px 0 0;font-size:12px;color:#888;font-family:sans-serif">${esc(trackingCarrier)}</p>` : ''}
      </div>` : ''}
      <p style="margin:0;line-height:1.6">Please allow a few days for delivery.</p>`,

    complete: `<p style="margin:0 0 16px;line-height:1.6">Your commission is complete! We hope you love your new piece${(order.quantity as number) > 1 ? 's' : ''}.</p>
      <p style="margin:0;line-height:1.6">Thank you for your trust in Azoir & Co. We'd love to work with you again.</p>`,

    cancelled: `<p style="margin:0 0 16px;line-height:1.6">Your B2B order has been cancelled.</p>
      ${note ? `<p style="margin:0 0 16px;line-height:1.6"><strong>Reason:</strong> ${esc(note)}</p>` : ''}
      <p style="margin:0;line-height:1.6">If you have questions, please contact us at <a href="mailto:info@azoir.co" style="color:#0a0a0a">info@azoir.co</a>.</p>`,
  };

  const bodyContent = bodyMap[newStatus] ?? `<p style="margin:0;line-height:1.6">Your order status has been updated to <strong>${newStatus}</strong>.</p>`;

  const orderMeta = `<div style="margin-top:24px;padding:16px;background:#fafaf8;border-radius:4px;font-family:sans-serif;font-size:13px">
    <p style="margin:0 0 6px;color:#aaa;font-size:11px;letter-spacing:0.1em;text-transform:uppercase">Order Reference</p>
    <p style="margin:0;color:#0a0a0a"><strong>${esc(order.company_name as string)}</strong>${order.po_number ? ` — PO: ${esc(order.po_number as string)}` : ''}</p>
    <p style="margin:4px 0 0;color:#888">${esc(order.metal as string ?? '')}${order.quantity ? ` · Qty ${order.quantity}` : ''}</p>
  </div>`;

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
            <p style="margin:6px 0 0;color:rgba(255,255,255,0.5);font-size:11px;letter-spacing:0.2em;font-family:sans-serif;text-transform:uppercase">Trade Partner Order Update</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px 40px 32px;color:#1a1a1a;font-size:15px">
            <p style="margin:0 0 24px;font-size:17px">Dear ${firstName},</p>
            ${bodyContent}
            ${orderMeta}
          </td>
        </tr>
        <tr>
          <td style="padding:0 40px 32px">
            <a href="https://azoir-co.myshopify.com/pages/b2b-dashboard"
              style="display:inline-block;background:#0a0a0a;color:#fff;padding:12px 24px;text-decoration:none;border-radius:4px;font-family:sans-serif;font-size:13px">
              View My Orders
            </a>
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
      subject,
      content: [{ type: "text/html", value: html }],
    }),
  });
}

function esc(str: string): string {
  return String(str ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

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
