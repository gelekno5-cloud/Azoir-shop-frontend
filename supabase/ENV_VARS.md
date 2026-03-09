# Azoir — Edge Function Environment Variables

Set all of these in:
**Supabase Dashboard → Edge Functions → Manage secrets**

---

## Required for all functions

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL (auto-set by Supabase) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key — never expose publicly |

---

## quote-submit

| Variable | Description |
|---|---|
| `ALLOWED_ORIGINS` | CORS origin — your Shopify store URL e.g. `https://azoir.myshopify.com` |

---

## shopify-payment-webhook

| Variable | Description | Where to get it |
|---|---|---|
| `SHOPIFY_WEBHOOK_SECRET` | Webhook signing secret | Shopify Admin → Settings → Notifications → Webhooks → your webhook |
| `PROCESS_JOB_URL` | Full URL of your process-job function | `https://avmcksqllodvspbtcmgf.supabase.co/functions/v1/process-job` |
| `PROCESS_JOB_SECRET` | Any strong random string — shared with process-job | Generate with `openssl rand -hex 32` |

---

## process-job (all via Twilio)

| Variable | Description | Where to get it |
|---|---|---|
| `PROCESS_JOB_SECRET` | Must match the one set in shopify-payment-webhook | Same value |
| `OPENAI_API_KEY` | OpenAI API key | platform.openai.com → API Keys |
| `EMAIL_FROM` | Sender address | e.g. `Azoir & Co <design@azoir.com>` (must be verified in SendGrid) |
| `INTERNAL_EMAIL` | Where job sheets go | e.g. `design@azoir.com` |
| `SENDGRID_API_KEY` | Twilio SendGrid API key (email) | app.sendgrid.com → Settings → API Keys |
| `TWILIO_ACCOUNT_SID` | Twilio account SID (SMS + WhatsApp) | twilio.com → Console Dashboard |
| `TWILIO_AUTH_TOKEN` | Twilio auth token | twilio.com → Console Dashboard |
| `TWILIO_PHONE_FROM` | Twilio phone number for SMS | e.g. `+61400000000` — buy in Twilio Console |
| `TWILIO_WHATSAPP_FROM` | Twilio WhatsApp sender | e.g. `whatsapp:+14155238886` — Twilio Sandbox or approved number |

---

## Shopify Webhook Setup

1. Shopify Admin → Settings → Notifications → scroll to **Webhooks**
2. Click **Create webhook**
3. Event: **Order payment** (`orders/paid`)
4. Format: JSON
5. URL: `https://avmcksqllodvspbtcmgf.supabase.co/functions/v1/shopify-payment-webhook`
6. API version: latest
7. Copy the **signing secret** shown → paste as `SHOPIFY_WEBHOOK_SECRET`

---

## Twilio SendGrid — sender verification

Before emails will send, verify your domain or email address:
1. app.sendgrid.com → Settings → Sender Authentication
2. Either **Domain Authentication** (recommended — verify `azoir.com`) or **Single Sender Verification** (quick, for testing)

---

## Deploy commands

```bash
# Deploy functions
npx supabase functions deploy quote-submit --no-verify-jwt
npx supabase functions deploy shopify-payment-webhook --no-verify-jwt
npx supabase functions deploy process-job --no-verify-jwt

# Set secrets
npx supabase secrets set SHOPIFY_WEBHOOK_SECRET=your_signing_secret
npx supabase secrets set OPENAI_API_KEY=sk-...
npx supabase secrets set SENDGRID_API_KEY=SG....
npx supabase secrets set EMAIL_FROM="Azoir & Co <design@azoir.com>"
npx supabase secrets set INTERNAL_EMAIL=design@azoir.com
npx supabase secrets set TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
npx supabase secrets set TWILIO_AUTH_TOKEN=your_auth_token
npx supabase secrets set TWILIO_PHONE_FROM=+61400000000
npx supabase secrets set TWILIO_WHATSAPP_FROM="whatsapp:+14155238886"
```
