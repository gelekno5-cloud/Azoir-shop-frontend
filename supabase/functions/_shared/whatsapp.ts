// ─────────────────────────────────────────────────────────────────────────────
// Azoir — WhatsApp sender via Twilio
// Env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM
//      (TWILIO_WHATSAPP_FROM must be in format: whatsapp:+XXXXXXXXXXX)
// ─────────────────────────────────────────────────────────────────────────────

export interface WhatsAppResult {
  sid: string | null;
  error: string | null;
}

export async function sendWhatsApp(to: string, body: string): Promise<WhatsAppResult> {
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken  = Deno.env.get("TWILIO_AUTH_TOKEN");
  const from       = Deno.env.get("TWILIO_WHATSAPP_FROM");

  if (!accountSid || !authToken || !from) {
    return { sid: null, error: "Twilio WhatsApp credentials not configured" };
  }

  // Ensure 'to' has whatsapp: prefix
  const toWa = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const credentials = btoa(`${accountSid}:${authToken}`);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: toWa, From: from, Body: body }).toString(),
    });

    const data = await res.json();
    if (!res.ok) {
      return { sid: null, error: data.message ?? `Twilio WhatsApp error ${res.status}` };
    }
    return { sid: data.sid ?? null, error: null };
  } catch (err) {
    return { sid: null, error: String(err) };
  }
}
