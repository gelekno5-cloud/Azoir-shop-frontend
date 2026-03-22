# Shopify Rules — Azoir

## Boundary (Critical)
Liquid runs on Shopify servers — it cannot call Supabase. All Supabase/Edge Function calls happen in client-side `<script>` blocks using the anon key from section settings.

Never put the service role key in Liquid. Anon key is safe to expose in section settings.

## Template JSON Requirements
Any page using `commission-ring-2col.liquid` must have these section settings:
```json
"supabase_url": "https://avmcksqllodvspbtcmgf.supabase.co",
"supabase_anon_key": "<anon key>",
"supabase_bucket": "<bucket name>",
"edge_function_url": "https://avmcksqllodvspbtcmgf.functions.supabase.co/quote-submit",
"design_fee_redirect": "/pages/design-fee-page"
```

## Cart API (Design Fee)
- Variant ID: `48059146109153` ($59)
- `request_id` is embedded as a line item property via Cart API — this is how the webhook traces payment back to the commission. Do not rename this property without updating `shopify-payment-webhook`.

## Webhook
- `orders/paid` → `shopify-payment-webhook` edge function
- HMAC secret: `SHOPIFY_WEBHOOK_SECRET` in Supabase secrets
- Webhook URL registered in Shopify Admin → Notifications

## assets/ Rule
CSS, JS, SVGs only. No image files. Use `placeholder_svg_tag` or a CDN URL instead.
