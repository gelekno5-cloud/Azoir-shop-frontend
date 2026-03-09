# Azoir Theme — Claude Memory

## Project Overview
Custom Shopify theme for **Azoir & Co** (azoir-co.myshopify.com), a luxury bespoke jewellery brand. Built on the **Vessel** base theme.

## Store
- **Shopify store**: azoir-co.myshopify.com
- **Live theme**: Azoir Task Force (ID: 159714935009)
- **Theme editor**: https://azoir-co.myshopify.com/admin/themes/159714935009/editor

---

## Commission Flow
```
/pages/commission              ← hub (page.commission.liquid)
  ├── /pages/commission-ring        → page.commission-ring.json
  ├── /pages/commission-pendant     → page.commission-pendant.json
  ├── /pages/commission-necklace    → page.commission-necklace.json
  ├── /pages/commission-bracelet    → page.commission-bracelet.json
  └── /pages/custom-inquiry         → page.custom-inquiry.json

/pages/design-ring             → page.design-ring.json  (commission-ring-2col)
/pages/design-fee-page         → page.design-fee-page.json
```

**Form submission flow:**
1. Customer fills `commission-ring-2col.liquid` form
2. JS POSTs to `quote-submit` Edge Function → saves to `quote_requests`
3. Redirect to `/pages/design-fee-page?request_id=UUID&from=ENCODED_URL`
4. Design fee page fetches submission from Supabase, shows summary
5. "Pay Design Fee" button uses Cart API → embeds `request_id` as line item property → `/checkout`
6. Shopify fires `orders/paid` webhook → `shopify-payment-webhook` Edge Function
7. Webhook verifies HMAC, records payment, creates job, fires `process-job`
8. `process-job`: OpenAI generates job sheet + customer confirmation → Twilio sends notifications

**Edit flow:** `?edit_request_id=UUID` pre-fills form from Supabase. On re-submit, payload includes original `request_id`.

---

## Custom Sections

| File | Purpose |
|---|---|
| `commission-ring-2col.liquid` | Main commission form (2-col layout) — rings, pendants, necklaces, bracelets |
| `commission-rings-form.liquid` | Legacy single-col commission form |
| `commission-form.liquid` | Generic commission form |
| `commission-hero.liquid` | Hero banner |
| `commission-intro.liquid` | Intro copy |
| `commission-rings-info.liquid` | Ring info/options |
| `commission-process.liquid` | Process steps |
| `commission-faq.liquid` | FAQ accordion |
| `commission-gallery.liquid` | Portfolio gallery |
| `start-your-piece.liquid` | CTA card grid (with hover animations) |
| `design-fee.liquid` | Post-payment design fee page |

---

## CSS

Custom stylesheets in `assets/`:
- `commission-rings.css` — all commission form + design-fee page styles
- `homepage-buttons.css` — homepage CTA button styles

CSS naming:
- Commission form: `cr-` prefix (e.g. `cr-phone`, `cr-contact-btn`, `cr-upload__icon-wrap`)
- Design fee page: `design-fee__` prefix
- Legacy: `bz-` prefix

Key style notes:
- Primary black: `#0a0a0a`
- Pay button hover: `#08CB00`
- Brand bg: `#fafaf8` / `#f5f4f0`
- Active contact buttons use `!important` to override theme specificity
- Card hover lift: `translateY(-4px)`, `transition-duration: 0.12s`

---

## Commission Form Features (commission-ring-2col.liquid)
- Country: full 195-country `<select>`
- Phone: `.cr-phone` flex combo (country code select + number input, auto-fills from country selection)
- Contact method: three `.cr-contact-btn` icon buttons (Email / Text / WhatsApp) — one stays selected, no deselect on re-click
- Upload zone: icon-based design, preview grid with hover overlay + remove button
- Validation: shake animation + red border + inline error on submit
- Supabase/Edge Function URL comes from section settings in template JSON

---

## Backend — Supabase

**Project URL**: `https://avmcksqllodvspbtcmgf.supabase.co`
**Anon key**: in all `commission-ring-2col` template JSON files

### Tables (`public` schema, RLS enabled)

| Table | Purpose |
|---|---|
| `quote_requests` | One row per commission enquiry. Anon can SELECT by UUID. |
| `payments` | One row per Shopify order. `shopify_order_id` = idempotency key. |
| `jobs` | Design job per payment. Ref format: `AZR-YYYY-NNNNN`. |
| `ai_outputs` | OpenAI-generated job sheet + customer confirmation per job. |
| `notifications` | Delivery tracking per channel (email/sms/whatsapp). |
| `processing_logs` | Full audit trail of the processing pipeline. |

Migrations: `supabase/migrations/001_quote_requests.sql`, `002_backend_schema.sql`

### Edge Functions

| Function | Purpose | Deploy flag |
|---|---|---|
| `quote-submit` | Receives form POST, saves to `quote_requests` | `--no-verify-jwt` |
| `shopify-payment-webhook` | Receives Shopify `orders/paid`, verifies HMAC, records payment + job, fires `process-job` | `--no-verify-jwt` |
| `process-job` | OpenAI generation + Twilio notifications | `--no-verify-jwt` |

Shared modules: `supabase/functions/_shared/` — `types.ts`, `ai.ts`, `email.ts`, `sms.ts`, `whatsapp.ts`, `notifications.ts`, `job-processor.ts`

### Secrets (all set)
`OPENAI_API_KEY`, `SENDGRID_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_FROM` (+18333492380), `TWILIO_WHATSAPP_FROM` (whatsapp:+14155238886), `SHOPIFY_WEBHOOK_SECRET`, `PROCESS_JOB_SECRET`, `PROCESS_JOB_URL`, `EMAIL_FROM`, `INTERNAL_EMAIL` (gelek@azoir.co), `ALLOWED_ORIGINS` (*)

Full env var reference: `supabase/ENV_VARS.md`

---

## Design Fee
- Flat **$59** across all pages
- Shopify variant ID: `48059146109153`
- Payment URL: `/cart/48059146109153:1`
- Pay button uses Cart API to embed `request_id` as line item property so webhook can extract it

---

## Shopify CLI
```bash
npx @shopify/cli theme push --theme 159714935009 --allow-live   # push to live
npx @shopify/cli theme pull --theme 159714935009                # pull from live
npx @shopify/cli theme dev                                       # local dev (localhost:9292)
npx supabase functions deploy FUNCTION_NAME --no-verify-jwt     # deploy edge function
```

`.shopifyignore` excludes `*.tmp*` editor temp files.

---

## Key Conventions
- **No image files in `assets/`** — only CSS/JS/SVGs. Use `placeholder_svg_tag` or upload image first.
- `main-page.liquid` has login gate for `page.get-a-quote` template.
- Scroll reveal: `IntersectionObserver` + `.bz-reveal` / `.is-in` class pattern.
- Page-load animation: `.bz-enter` on wrapper, `bz-js` on `<html>`.
- All template JSON files for `commission-ring-2col` pages must include: `supabase_url`, `supabase_anon_key`, `supabase_bucket`, `edge_function_url`, `design_fee_redirect`.
