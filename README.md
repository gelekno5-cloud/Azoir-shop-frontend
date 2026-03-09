# Azoir & Co — Shopify Theme

Luxury bespoke jewellery store. Custom Shopify theme built on Vessel, with a full commission-to-production backend.

## Stack

| Layer | Tech |
|---|---|
| Storefront | Shopify (Liquid) |
| Database | Supabase (PostgreSQL + RLS) |
| Backend | Supabase Edge Functions (Deno/TypeScript) |
| AI | OpenAI GPT-4o-mini |
| Email | Twilio SendGrid |
| SMS / WhatsApp | Twilio |
| Payments | Shopify Payments |

---

## Commission Flow

```
Customer fills form
  → Supabase (quote_requests)
  → Design fee page (/pages/design-fee-page?request_id=UUID)
  → Shopify checkout (request_id embedded as line item property)
  → orders/paid webhook
  → Payment + job recorded in Supabase
  → OpenAI generates job sheet + customer confirmation
  → Twilio sends notification (email / SMS / WhatsApp based on preference)
```

---

## Project Structure

```
sections/
  commission-ring-2col.liquid     ← main commission form
  design-fee.liquid               ← design fee payment page
  commission-*.liquid             ← other commission sections

templates/
  page.commission-ring.json
  page.commission-pendant.json
  page.commission-necklace.json
  page.commission-bracelet.json
  page.design-ring.json
  page.design-fee-page.json

assets/
  commission-rings.css            ← all commission + design-fee styles

supabase/
  migrations/
    001_quote_requests.sql        ← main submissions table
    002_backend_schema.sql        ← payments, jobs, notifications, ai_outputs, logs
  functions/
    quote-submit/                 ← form submission handler
    shopify-payment-webhook/      ← Shopify orders/paid webhook
    process-job/                  ← AI generation + notifications
    _shared/                      ← types, ai, email, sms, whatsapp, notifications, job-processor
  ENV_VARS.md                     ← all environment variables reference
```

---

## Local Development

```bash
# Install Shopify CLI
npm install -g @shopify/cli

# Start local dev server (syncs live with theme editor)
npx @shopify/cli theme dev

# Push changes to live theme
npx @shopify/cli theme push --theme 159714935009 --allow-live

# Pull latest from Shopify
npx @shopify/cli theme pull --theme 159714935009
```

---

## Edge Functions

```bash
# Deploy all functions
npx supabase functions deploy quote-submit --no-verify-jwt
npx supabase functions deploy shopify-payment-webhook --no-verify-jwt
npx supabase functions deploy process-job --no-verify-jwt

# View/set secrets
npx supabase secrets list
npx supabase secrets set KEY=value
```

See `supabase/ENV_VARS.md` for the full list of required environment variables.

---

## Database Migrations

Run SQL files in order via **Supabase Dashboard → SQL Editor**:

1. `supabase/migrations/001_quote_requests.sql`
2. `supabase/migrations/002_backend_schema.sql`

---

## Shopify Webhook

Register at: **Shopify Admin → Settings → Notifications → Webhooks**

- Event: `Order payment`
- URL: `https://avmcksqllodvspbtcmgf.supabase.co/functions/v1/shopify-payment-webhook`
- Format: JSON
- Copy the signing secret → set as `SHOPIFY_WEBHOOK_SECRET`

---

## Design Fee

- Price: **$59 flat**
- Shopify variant ID: `48059146109153`
- The pay button uses the Cart API to embed `request_id` as a line item property, which the webhook reads to link the payment to the correct submission.

---

## Notifications

Customers receive a confirmation via whichever channel they selected on the form:

| Channel | Provider |
|---|---|
| Email | Twilio SendGrid |
| SMS | Twilio (+1 833 349 2380) |
| WhatsApp | Twilio Sandbox (+1 415 523 8886) |

Internal job sheets are always sent to `gelek@azoir.co` via SendGrid.

> **Note:** To send from `gelek@azoir.co`, complete sender verification in SendGrid: app.sendgrid.com → Settings → Sender Authentication.
