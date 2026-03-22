# Azoir OS — Claude Workspace

## Project
Custom Shopify theme + Supabase backend for Azoir & Co (azoir-co.myshopify.com), a luxury bespoke jewellery brand. Vessel base theme.

Store: azoir-co.myshopify.com | Live theme ID: `159714935009`

## Architecture Boundaries

| Layer | Tech | Location |
|---|---|---|
| Storefront | Liquid + vanilla JS | `sections/`, `assets/`, `templates/` |
| Backend | Supabase Edge Functions (Deno/TS) | `supabase/functions/` |
| DB | PostgreSQL + RLS | `supabase/migrations/` |
| Notifications | SendGrid + Twilio | `_shared/email.ts`, `_shared/sms.ts` |

**Critical boundary:** Liquid cannot talk to Supabase. All API calls happen in client-side `<script>` blocks using the anon key from section settings.

## Key Files
- `sections/commission-ring-2col.liquid` — main commission form
- `sections/design-fee.liquid` — post-submission payment page
- `assets/commission-rings.css` — all commission + design-fee styles
- `supabase/functions/quote-submit/` — form ingestion
- `supabase/functions/shopify-payment-webhook/` — order webhook + HMAC
- `supabase/functions/process-job/` — OpenAI generation + notifications
- `supabase/functions/_shared/` — types, ai, email, sms, notifications

## Coding Rules
- Read files before editing. Never guess at existing code.
- Minimal diffs only. Do not touch code outside the task scope.
- Vanilla JS in Liquid sections — no build step, no frameworks.
- TypeScript in Edge Functions only.
- CSS prefixes: `cr-` (commission form) · `design-fee__` (design fee page) · `bz-` (legacy)
- No image files in `assets/` — use `placeholder_svg_tag` or CDN URL.
- All `commission-ring-2col` template JSONs must include: `supabase_url`, `supabase_anon_key`, `supabase_bucket`, `edge_function_url`, `design_fee_redirect`.

## UI Rules
- Palette: `#0a0a0a` black · `#fafaf8` / `#f5f4f0` cream · `#08CB00` pay-button hover only
- Transitions: `0.12s ease`. Never slower for micro-interactions.
- Hover lift: `translateY(-4px)` · `box-shadow: 0 12px 32px rgba(0,0,0,0.09)`
- No gradients. No text shadows. No decorative motion.
- Do not override `font-family` — let the theme handle it.

## Safety Rules
- Never read or commit `.env` / `.env.*`.
- Never run `rm -rf` without user confirmation.
- Never push to live theme without user confirmation.
- Never deploy Edge Functions without user confirmation.
- RLS must stay enabled on all tables. Never bypass HMAC verification.

## Deploy Commands
```bash
npx @shopify/cli theme push --theme 159714935009 --allow-live
npx @shopify/cli theme pull --theme 159714935009
npx supabase functions deploy FUNCTION_NAME --no-verify-jwt
```
