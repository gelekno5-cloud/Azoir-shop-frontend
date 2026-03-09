// ─────────────────────────────────────────────────────────────────────────────
// Azoir — SMS sender via Twilio
// Env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_FROM
// ─────────────────────────────────────────────────────────────────────────────

export interface SmsResult {
  sid: string | null;
  error: string | null;
}

export async function sendSms(to: string, body: string): Promise<SmsResult> {
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken  = Deno.env.get("TWILIO_AUTH_TOKEN");
  const from       = Deno.env.get("TWILIO_PHONE_FROM");

  if (!accountSid || !authToken || !from) {
    return { sid: null, error: "Twilio credentials not configured" };
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const credentials = btoa(`${accountSid}:${authToken}`);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
    });

    const data = await res.json();
    if (!res.ok) {
      return { sid: null, error: data.message ?? `Twilio error ${res.status}` };
    }
    return { sid: data.sid ?? null, error: null };
  } catch (err) {
    return { sid: null, error: String(err) };
  }
}
