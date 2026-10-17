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

## 2026-08-20 session

- ⚠️ **CRITICAL — rotate the Supabase service_role key.** `test-email.sh` in THIS PUBLIC repo
  contains a live service_role key for the shared production Supabase (`avmcksqllodvspbtcmgf`
  — same DB as Moksh Diam). It bypasses RLS: full read/write on b2b_orders, b2b_registrations,
  retail_inquiries. Rotate in the Supabase dashboard first, then delete the file, purge history
  (or recreate the repo), make the repo private. Nothing else matters until this is done.
- **Full site audit** (13 findings: no funnel analytics events, bot gate silently drops real
  leads, no mobile nav below 900px, 9.2 MB homepage, no JSON-LD, no security headers):
  artifact "azoir.co Assay" → https://claude.ai/code/artifact/65c773b0-5422-40a9-afd1-ffcbbc0f9b29
- **Redesign direction in progress** — clickable prototype of a new azoir.co built this session:
  `design/commission-studio-prototype.html` (self-contained, open in any browser). Live artifact:
  https://claude.ai/code/artifact/0dc3fd0b-a029-4a4e-bab6-15b974e790c4
  Concept: hero = jewelry line-art that draws itself (constant pen-speed SVG engine);
  two doors (start with setting / start with stone); 4-step studio, one question per screen;
  ten facet-diagram cut icons; stone-first door shows a real-time 3D diamond (custom WebGL,
  two-pass transparent, per-channel refraction fire) — 3D deliberately ONLY in that door.
  Decided along the way: white ground, warm ink, indigo only for interaction; wizard traps
  trackpad back-swipe as step-back. Deliberately NOT reusing any Moksh Diam viewer code.
- **Skills added** to `.claude/skills/`: taste-skill + redesign-skill (see skills/VENDORED.md —
  it also flags that `.claude/rules/frontend.md` and `design-review` still describe the DEAD
  Shopify theme, not the live `web/` site).
- **Open items:** photography with people/hands is still the biggest asset gap (hero can't say
  "this could be you" without it); pricing still absent at the end of the studio flow; heart
  cut in the hero pendant worth trying.

## 2026-10-16 session

- **Wedding band builder (iJewel-style) — built, not yet committed/deployed:** `web/wedding-bands.html` + `web/band-builder.js`.
  Procedural three.js band (three 0.186.1 from jsdelivr via an import map — no build step): profile (court / flat / D-shape /
  knife edge / bevelled), comfort-fit or flat interior, width 2–8 mm, depth 1.2–2.6 mm, 7 metals, 4 finishes, channel-set
  half/full eternity, US size 4–13 (uses the ring-size guide's chart), inside engraving (3 styles), live weight estimate from
  the real swept volume (no prices — inquiry-only stays locked). Share link = URL hash; "Save image" = PNG; "Request this band"
  writes the spec into `azoir_wiz` localStorage and opens `commission.html` on step 2 with "Wedding bands" + metal preselected.
  "Wedding Bands" tab added to every page's nav (after Gallery) and a "Wedding bands" footer link; sitemap updated.
- **Band builder v2 (iJewel feature parity) — same two files, branch `claude/band-builder-v2-766095`:**
  - **His & Hers pair:** "One band / His & Hers pair" toggle; two rings side by side; "Linked" shares profile, interior, edges,
    zones, metals and finish, while width, depth, size, diamonds and engraving stay per band; "Independent" shares nothing.
    Summary, spec sheet and the commission hand-off list both bands. Band B lives in the hash as `b_*` keys (only when `pair=1`).
  - **Colour zones:** 1–3 zones across the width, each with its own metal + finish (`zones`, `metal2/finish2`, `metal3/finish3`).
    Zones are material groups on one lathe geometry, split by y, so the weight estimate is per zone (a two-tone band really is
    two rings soldered side by side). Stones straddle the centre zone.
  - **Settings & spans:** channel / bezel (instanced collars) / prong (shared prongs between stones); span none / full / half /
    ⅓ / ¼ (`stones` keeps its v1 values and gains `third`, `quarter`); stone size petite / classic / bold (`stonesz`); the note
    under it shows the mm each gives at the current width.
  - **Edges per side** (`edgel`, `edger`: rounded / bevel / sharp) — the outer polyline is trimmed by the fillet/chamfer
    distance before the corner is shaped, and sharp corners / chamfers split the lathe "runs" so shading stays crisp.
    New profiles: concave, full round (round ignores interior + edges).
  - **Sizes:** US (same chart as `ring-size.html`), EU (ISO circumference) and UK letters (H = US 3¾, one letter = ½ US size);
    `size` stays a US number in the hash, `sizesys` remembers the picker. Summary shows all three + inside Ø.
  - **Tabs** (Shape & Size · Metals & Design · Diamonds · Engraving) and a **Spec sheet** button: an in-page print view
    (`.bb-sheet`, appended to `<body>`, `@media print` hides everything else) with logo, reference code (FNV hash of the share
    link → `AZB-XXXXXX`, stable for the same design), 3D snapshot, per-band cross-section SVG with mm dimensions and zone
    colours, size in all systems, metal per zone, stone count/carats, engraving, est. weight. "Print / save PDF" = `window.print()`.
  - **Rendering pass (same session, after a side-by-side with iJewel's demo):** `NeutralToneMapping` (ACES bleached bright
    gold to white); metal `color` = each alloy's true F0 reflectance; a high-key studio of feathered softboxes with two black
    flags (the dark bands in the reflections are what makes metal read as metal); a real cast shadow via a near-zero
    `DirectionalLight` + `ShadowMaterial` ground at `GROUND_Y`, every ring stood on it; finishes are generated height fields at
    true mm scale → normal maps (hammered = overlapping dimples with ridges, matte = sandblast grit, satin = brush lines + a
    roughness map, since brushed metal reads as streaks of sheen more than as grooves); diamonds are transmissive with dispersion.
  - **Beyond iJewel:** two-tone split slider (`zsplit`, left share) and three-tone centre width (`zmid`); milgrain edge
    (`edgel`/`edger` = `milgrain`: a rounded edge plus a row of instanced beads in that edge's metal, counted in the weight).
  - **UI pass (branch `claude/band-builder-ui`):** the page is now a full-height studio — viewer fills the left (sticky, warm
    radial backdrop, floating icon tools with tooltips, intro copy top-left, chip bottom-left), a 460 px stepper panel on the
    right (pair controls → numbered tabs → scrolling options with "Continue to …" buttons → collapsible full spec → sticky
    action bar with the design title, key numbers and the request CTA). Profile icons are generated from the real
    `outerRadius`/`innerRadius` math. Page-local tokens (`--bb-*`, warm neutrals, ink selection, a gold kicker) deliberately
    diverge from the site's blue. Phone: viewer sticky at 46dvh, panel slides over it, action bar sticks to the bottom.
    ⚠ Don't use a `<nav>` inside the builder — azoir.css pins every `nav` to the top of the page.
  - **Cobalt palette (branch `claude/band-builder-cobalt`):** page-local tokens are now white / cool grey / ink `#14161C` with
    one accent `#2B4DFF` (tint `#DCE2FF`) used only for selection, the active step, slider fill and the CTA. Sliders are
    tick-rail sliders (a `.bb-rail` of mm ticks behind the input, `--ticks` per slider) with a cobalt value bubble that follows
    the thumb (`--pf`); the request CTA is a cobalt pill with a white arrow puck that rotates on hover. Tools are a white pill
    cluster at the bottom centre of the stage. ⚠ Deploy gotcha: `npx @railway/cli up` uploads the *git root*, so from a
    worktree it ships the main checkout — pull `main` there first.
  - **Stone shapes & settings to manufacturing rules (branch `claude/band-builder-settings`):** `SHAPES` (round, princess,
    cushion, emerald, baguette — real low-poly cut stones from `stoneGeometry`: table, crown steps, girdle, pavilion to a
    point or a keel; emerald/baguette run across the band) and `SETTINGS` (channel, bar, bezel, shared prong, split prong,
    fishtail, U-prong — all real metal attached to the band via `Mesher`/instanced parts, seated in a groove cut into the
    lathe). `stoneRules()` is the single source of truth: allowed shapes per setting, min band width (stone + 2×wall/rim, or
    stone + 0.6/0.9 for prong families), seat depth (pavilion + 0.3 mm floor, + crown when the table sits flush) ≤ band depth,
    fishtail 1.3–2.5 mm. The UI disables what fails and prints the reason (`#bbRuleNote`); `coerceStones()` steps the size
    down or drops the stones when the band changes under them (`#bbStoneNote`). Shared prongs are placed so each touches both
    neighbours (pitch solved from prong Ø and the ±zp offset). Prong Ø 0.55 (0.6 on platinum). Weight = lathe volume (groove
    already cut) + setting metal. Hash: `shape` added; old `setting` values are unchanged names. Spec sheet/summary gain
    "Setting" and "Fit rules" rows and draw the stone section. Known approximations: prong-family seats are a continuous
    shallow groove (real rings drill per stone); bezel rows are flush rims with metal bridges between; fishtail points are
    an hourglass prism + 4 beads.
  - **Batch 2 (branch `claude/band-builder-batch2`, stacked on the stones PR):** "Try it on" tool → lazy `GLTFExporter`
    bakes the active band (instances merged, plain PBR materials, mm, axis +Y, centred) to a GLB and posts
    `{type:'tryon:set', config:{type:'ring', metal, model, units:'mm', innerDiameterMm}}` to an iframe of
    `https://jewel-tryon.pages.dev/?type=ring&embed=1` once it sends `tryon:ready` (origin-checked both ways); "Open on your
    phone" draws the share link as a QR (qrcode-generator 1.4.4 from cdnjs, lazy). **Wave** (`wave` amplitude, `wavef`,
    `wavemode` groove/split/both): `sectionAt(sec, depth, th)` varies the section per angle — a 0.6 mm groove meanders on the
    outer surface and/or the two-zone seam is warped (points move, zone groups stay fixed; per-angle clip bounds keep the
    per-zone weight honest). Sampling goes to 96 outer points when a wave is on. **Finishes** +brushed (lines across, own
    roughness map), sandblast, ice (Voronoi facets), bark (wandering ridges). **Custom section** (Shape step): SVG path /
    DXF polyline / Rhino .3dm (rhino3dm 8.4.0 lazy from jsdelivr) → `prepareCustom()` resamples, requires closed, simple,
    1.5–12 × 0.8–5 mm, every wall ≥ 0.8 mm (horizontal scan), stores in localStorage `azoir_band_profile`; `profile=custom`
    in a link only works in the browser that imported it (falls back to court). Stones/edges/interior/wave are off for
    custom sections. **Spec JSON**: `specJSON()` → "Download spec (JSON)" on the sheet bar and appended to the commission
    hand-off message. **Catalogue**: `web/band-catalog.json` is fetched at start and merged over the baked-in tables
    (names, colours, densities, setting numbers, defaults, size chart, `hidden` lists remove options); the JS tables are the
    fallback. **Chip**: `chipCheck()` hides the stage chip when it would overlap the toolbar pill.
  - Old v1 share links still load unchanged (all original keys kept; defaults for the new ones).
  - Phone: the single-column grid is `minmax(0,1fr)` — plain `1fr` let the panel's min-content push the page to 490 px at 375.
    The only remaining horizontal overflow site-wide is `.page-hero::before` (560 px glow), masked by `body{overflow-x:hidden}`.
  - Testing in the Claude browser pane: hash-only navigation does not reload the module (use `location.reload()`), and the
    pane lays the page out wider than its screenshot; for a true 375 px test drop the page in a 375 px iframe and measure there.
- Gotchas: `express.static` caches 1h, so bump `band-builder.js?v=N` in the HTML when the JS changes. Lit by a custom studio
  environment only — a directional light on polished metal tone-maps the whole band white. Mobile nav is still missing site-wide
  (the tab is only visible ≥900px), per the 2026-08-20 audit.

