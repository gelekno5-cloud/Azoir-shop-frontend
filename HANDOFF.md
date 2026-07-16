# Azoir retail site — status & remaining steps

Consumer storefront for **azoir.co** (bespoke fine jewelry). Separate from Moksh Diam (the B2B/trade side). This repo (the old dead Shopify theme) is being repurposed — the new site lives in **`web/`**; the old theme files are left untouched for now.

## ✅ What's done and LIVE
- **Live now:** https://azoir-retail-production.up.railway.app
- **Railway project:** `azoir-retail` (workspace: gelekno5-cloud's Projects) — separate service from Moksh Diam's `lucky-patience`.
- **Stack:** static HTML/CSS + tiny Express `server.js` (single dep: `express`). `npm start` → serves `web/`, handles the commission form.
- **Pages:** `web/{index,how,gallery,about,commission,thanks}.html`, shared `web/azoir.css`. Light/blue brand, Cormorant + DM Sans, AZOIR wordmark.
- **Hero video:** `web/media/hero.mp4` (832 KB, 1080p H.264 — transcoded from the old 8K HEVC clip).
- **Commission form:** POST `/inquiry` → emails `hello@azoir.co` via Resend; redirects to `/thanks.html`. Logs (doesn't email) until `RESEND_API_KEY` is set.
- **Locked decisions:** crafted in **NYC**; **inquiry-only, no prices**.

## ⬜ Remaining — 2 steps to finish azoir.co

### 1. Cloudflare DNS (azoir.co zone)
- **Delete** the old Shopify A record: `azoir.co  A  23.227.38.65`
- **Add** CNAME: name `@` → target `enrsdse5.up.railway.app` → **Proxy OFF (grey / "DNS only")**
- **Add** TXT: name `_railway-verify` → content `railway-verify=9762dc5eb0240bda552050ad231d9db98cc89cb218b25c6b5af7fd9fa215371d`
- **DO NOT touch** email records: the `…sendgrid.net` CNAMEs, `_domainkey`/DKIM, any MX. (azoir.co email is load-bearing.)
- After saving, Railway auto-verifies and issues SSL (minutes, up to 72h to propagate).

### 2. Railway env var (so the form emails)
- Railway → `azoir-retail` → **Variables** → add `RESEND_API_KEY` (same Resend account Moksh Diam uses, or a fresh key).
- Optional: `INQUIRY_EMAIL` (default `hello@azoir.co`), `INQUIRY_FROM` (default `Azoir & Co <hello@azoir.co>`).

## Working locally / deploying updates
```bash
npm install          # installs express
npm start            # → http://localhost:3000

# deploy an update to Railway:
railway link         # pick project: azoir-retail
railway up           # uploads + builds + deploys
```
`.railwayignore` keeps the old Shopify theme + the 21 MB source video out of the deploy.

## Known gaps / next ideas
- **Imagery:** everything is the AZOIR ring + CAD/orb renders. No photos of necklaces/earrings/lifestyle (old Shopify CDN photos are gone). New renders/photos needed to fill the gallery + testimonial.
- Copy specifics (testimonial name "Amara R.", etc.) are placeholders.
- Could later connect the GitHub repo to Railway for push-to-deploy, and/or store inquiries in a DB.
