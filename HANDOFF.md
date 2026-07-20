# Azoir retail — status & handoff

Consumer storefront for **azoir.co** (bespoke fine jewelry), separate from Moksh Diam (the B2B/trade side). The site lives in **`web/`** of this repo (the old dead Shopify theme is left untouched alongside it).

## ✅ LIVE right now
- **azoir.co** — full site, DNS + SSL done, deployed on Railway project **`azoir-retail`** (separate from Moksh Diam's `lucky-patience`). Also at `azoir-retail-production.up.railway.app`.
- **Stack:** static HTML/CSS + tiny Express `server.js` (single dep: `express`). `npm start` serves `web/` + handles `/inquiry`.
- **Pages:** `web/{index,how,gallery,about,commission,thanks,404,terms,privacy,shipping,accessibility}.html`, shared `web/azoir.css`. Light/blue brand, Cormorant + DM Sans, AZOIR wordmark. Scroll-driven sketch→render hero (`web/hero-scrub.js` + `web/media/seq/`).
- **Phase 0 (foundations):** SEO/OG meta, favicon + OG image, legal pages, custom 404, robots.txt, sitemap.xml, www→apex 301, **GA4 `G-DJVC5Y7EPF`** + cookie-consent banner (`web/analytics.js`).
- **Phase 1 (guided inquiry) — DONE:**
  - `web/commission.html` + `web/wizard.js` — 5-step wizard (piece → materials → budget/timeline → story → contact): progress bar, back/forward, localStorage, visual pickers.
  - `POST /inquiry` (in `server.js`) → **saves to Supabase `retail_inquiries`** + emails the brief to `hello@azoir.co` + **warm auto-reply to the customer** → `/thanks.html`. Saving is non-fatal (email is the safety net).
  - Env on `azoir-retail` Railway: `RESEND_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (all set).
  - **Admin view lives in the MOKSH DIAM repo** (`azoir-b2b-admin-`): `app/routes/app.inquiries.tsx` → **admin.mokshdiam.com/app/inquiries** (Commerce → Inquiries). Deployed to production.
- **Locked decisions:** crafted in **NYC**; **inquiry-only, no prices**.

## Run & deploy (Azoir retail)
```bash
npm install && npm start          # → http://localhost:3000
railway link -p c50d15c9-ff66-4c23-bde2-3e0059454510   # link to azoir-retail
railway up --ci                   # build + deploy to azoir.co
```
`.railwayignore` keeps the old Shopify theme + 21 MB source video out of the deploy.
**Push needs a fresh fine-grained GitHub PAT each session** (Contents:write on `Azoir-shop-frontend`) — the Codespace token can't push here.

## Admin (Moksh Diam repo) — deploy
Moksh Diam **auto-deploys from `main`**. To ship an admin change: commit on a branch, then `git checkout main && git merge <branch> && git push origin main`.
⚠️ Its dev server OOMs in the Codespace (three.js/threepipe) — verify UI via typecheck + standalone preview, or in a beefier env.

## What's next (roadmap: `docs/ROADMAP.md`)
- **Phase 1 remaining (optional):** photo upload in the story step (Supabase storage); optional "book a design call" step (reuse the Moksh funnel Google Calendar slot-picker).
- **Phase 2:** Stripe payment links (design fee → deposit → balance).
- **Phase 3:** customer order tracking (magic link; reuse Moksh `b2b_orders` + channel column).
- **Phase 4:** **photography sprint** — biggest blocker; gallery + testimonial still recycle 4 renders. Copy specifics (e.g. testimonial "Amara R.") are placeholders.

## Gotchas
- **Work in this persistent clone (`/workspaces/Azoir-shop-frontend`), never the scratchpad** — scratchpad wiped twice and lost unpushed commits. Push each chunk immediately.
- Editing azoir.co DNS: only touch the website A/CNAME — **never** MX / Resend/SendGrid TXT/DKIM (Moksh Diam's email falls back to `hello@azoir.co`).
- `retail_inquiries` lives in the **shared Moksh Diam Supabase** (migration: `azoir-b2b-admin-/supabase/migrations/2026-07-17-retail-inquiries.sql`).

## 2026-07-20 session

- **Phase 2 payments SHIPPED & LIVE** (in the Moksh repo, `main`): retail commissions pay by link in 3 milestones (design fee → deposit → balance). Admin: "Convert to order" on `/app/inquiries`, then a "Retail Payments" card on the order. Customer pays at `os.azoir.co/pay/<token>` — no login. Migration `2026-07-20-retail-orders-payments.sql` is **already applied** to Supabase.
  - Retail orders = `b2b_orders` with the existing `customer_type='retail'`. Retail deliberately does **not** use `b2b_invoices`, so **retail payments do not appear in `/app/billing`**.
  - ⚠️ Untested: a real Stripe charge. Do a small live test (convert an inquiry, $1 design fee, pay it, confirm it flips to Paid).
- **Phase 3 specced, not built:** `azoir-b2b-admin-/docs/phase-3-retail-accounts.md`. Retail clients will approve designs in a simplified portal.
- **Homepage:** fabricated "Amara R." testimonial replaced with the atelier's own promise (live).
- ⚠️ **In the Moksh repo, run `npm run build` before merging** — a `.server` import used in a component passes typecheck and tests but fails the Remix client build.

### Where the numbers actually are
**0 retail inquiries, 0 retail orders, 4 days live.** The funnel works end to end; nothing is entering it. Check **GA4 `G-DJVC5Y7EPF`** before building more features — near-zero visitors is a distribution problem, visitors-without-inquiries is the photography gap. **Phase 4 photography is still the biggest blocker** and needs no code.
