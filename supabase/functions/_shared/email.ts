// ─────────────────────────────────────────────────────────────────────────────
// Azoir — Email sender via Twilio SendGrid
// Env: SENDGRID_API_KEY, EMAIL_FROM, INTERNAL_EMAIL
// ─────────────────────────────────────────────────────────────────────────────

const SENDGRID_API = "https://api.sendgrid.com/v3/mail/send";

export interface EmailResult {
  id: string | null;
  error: string | null;
}

export async function sendCustomerEmail(
  to: string,
  customerName: string,
  jobRef: string,
  body: string,
): Promise<EmailResult> {
  const from = Deno.env.get("EMAIL_FROM") ?? "design@azoir.com";
  const firstName = customerName.split(" ")[0];

  return sendEmail({
    from,
    to,
    subject: `Your design journey begins — ${jobRef}`,
    html: emailHtml(firstName, body, jobRef),
  });
}

export async function sendInternalJobSheet(
  jobRef: string,
  jobSheetContent: string,
  quoteId: string,
): Promise<EmailResult> {
  const from = Deno.env.get("EMAIL_FROM") ?? "design@azoir.com";
  const to   = Deno.env.get("INTERNAL_EMAIL") ?? "design@azoir.com";

  return sendEmail({
    from,
    to,
    subject: `[NEW JOB] ${jobRef} — Design Fee Received`,
    html: jobSheetHtml(jobRef, jobSheetContent, quoteId),
  });
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function sendEmail(payload: {
  from: string;
  to: string;
  subject: string;
  html: string;
}): Promise<EmailResult> {
  const apiKey = Deno.env.get("SENDGRID_API_KEY");
  if (!apiKey) return { id: null, error: "SENDGRID_API_KEY not set" };

  // SendGrid requires from as an object if it includes a name
  const fromParts = payload.from.match(/^(.+?)\s*<(.+?)>$/);
  const fromObj = fromParts
    ? { name: fromParts[1].trim(), email: fromParts[2].trim() }
    : { email: payload.from };

  try {
    const res = await fetch(SENDGRID_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: payload.to }] }],
        from: fromObj,
        subject: payload.subject,
        content: [{ type: "text/html", value: payload.html }],
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const msg = data.errors?.[0]?.message ?? `SendGrid error ${res.status}`;
      return { id: null, error: msg };
    }

    // SendGrid returns 202 with no body — message ID is in the header
    const messageId = res.headers.get("x-message-id") ?? null;
    return { id: messageId, error: null };
  } catch (err) {
    return { id: null, error: String(err) };
  }
}

function emailHtml(firstName: string, body: string, jobRef: string): string {
  const paragraphs = body
    .split(/\n\n+/)
    .map((p) => `<p style="margin:0 0 16px;line-height:1.6">${p.trim().replace(/\n/g, "<br>")}</p>`)
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f4f0;font-family:Georgia,serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f4f0;padding:40px 16px">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:4px;overflow:hidden">
        <tr>
          <td style="background:#0a0a0a;padding:32px 40px;text-align:center">
            <p style="margin:0;color:#fff;font-family:Georgia,serif;font-size:22px;letter-spacing:0.12em">AZOIR & CO</p>
            <p style="margin:6px 0 0;color:rgba(255,255,255,0.5);font-size:11px;letter-spacing:0.2em;font-family:sans-serif;text-transform:uppercase">Bespoke Jewellery</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px 40px 32px;color:#1a1a1a;font-size:15px">
            <p style="margin:0 0 24px;font-size:17px">Dear ${firstName},</p>
            ${paragraphs}
          </td>
        </tr>
        <tr>
          <td style="padding:0 40px 32px">
            <div style="background:#f5f4f0;border-left:3px solid #0a0a0a;padding:14px 20px;border-radius:0 4px 4px 0">
              <p style="margin:0;font-size:11px;letter-spacing:0.15em;color:#888;font-family:sans-serif;text-transform:uppercase">Your Project Reference</p>
              <p style="margin:4px 0 0;font-size:18px;font-weight:bold;color:#0a0a0a;font-family:monospace">${jobRef}</p>
              <p style="margin:6px 0 0;font-size:12px;color:#888;font-family:sans-serif">Keep this for your records</p>
            </div>
          </td>
        </tr>
        <tr>
          <td style="background:#f5f4f0;padding:24px 40px;text-align:center;color:#888;font-size:11px;font-family:sans-serif">
            <p style="margin:0">© Azoir & Co · <a href="mailto:design@azoir.com" style="color:#888">design@azoir.com</a></p>
            <p style="margin:8px 0 0">All design concepts remain property of Azoir & Co until production is commissioned.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function jobSheetHtml(jobRef: string, content: string, quoteId: string): string {
  const lines = content
    .split("\n")
    .map((l) => `<p style="margin:0 0 8px;line-height:1.5">${l.replace(/^([A-Z ]+:)/, "<strong>$1</strong>")}</p>`)
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:24px;font-family:monospace;font-size:13px;color:#1a1a1a;background:#fff">
  <table width="100%" style="border-bottom:2px solid #0a0a0a;padding-bottom:16px;margin-bottom:24px">
    <tr>
      <td><strong style="font-size:18px">AZOIR & CO — DESIGN JOB</strong></td>
      <td align="right" style="font-size:22px;font-weight:bold;letter-spacing:0.05em">${jobRef}</td>
    </tr>
  </table>
  <div style="background:#f9f9f9;padding:20px;border:1px solid #e0e0e0;border-radius:4px;white-space:pre-wrap;line-height:1.6">
    ${lines}
  </div>
  <p style="margin-top:24px;font-size:11px;color:#888">Quote ID: ${quoteId}</p>
</body>
</html>`;
}
