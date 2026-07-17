# Azoir & Co. — Retail Roadmap

**North star:** a client can *discover → inquire → pay → track* their commission
without a single email back-and-forth (unless they want the conversation).

Guiding constraints:
- Bespoke, inquiry-first — no public price list; pricing anchors only ("commissions from $X")
- Keep the stack simple: static pages + the small Express server, Supabase for data,
  Stripe for money, Resend for email — no framework rewrite
- Admin side lives in Moksh Diam OS (os.azoir.co), which already has orders,
  status flow, notes, and a customer portal — reuse it, don't rebuild it

---

## Phase 0 — Foundations (do first, ~1 session)

Ship what exists + the table stakes every store needs.

- [ ] Push repo to GitHub + deploy scroll-hero work to azoir.co (`railway up`)
- [ ] `www.` → apex 301 redirect in server.js
- [ ] Legal pages: Terms, Privacy, Shipping & Returns, Accessibility — link them in the footer (currently dead text)
- [ ] Meta: description, OG/Twitter cards, favicon, sitemap.xml, robots.txt, custom 404
- [ ] Analytics (Plausible or GA4) — right now we're blind to visitors
- [ ] Business identity in footer: contact email, city, company line

**Done when:** link previews look right, analytics is collecting, every footer link resolves.

---

## Phase 1 — Guided inquiry ("easy walk-through for customers")

Replace the flat commission form with a multi-step wizard that feels like a
conversation, not paperwork.

Steps: **1)** piece type (ring / necklace / earrings / heirloom redesign…) →
**2)** metal & stones (visual pickers) → **3)** budget band + timeline →
**4)** inspiration (photo upload + free text "tell us the story") →
**5)** contact details → **6)** optional: book a design call (reuse the
Google Calendar slot-picker built for the Moksh funnel).

- [ ] Wizard UI: progress bar, one question per screen, mobile-first, back/forward,
      answers survive refresh (localStorage)
- [ ] Photo upload (Supabase storage)
- [ ] `POST /inquiry` → Supabase `retail_inquiries` table + Resend: notification to
      hello@azoir.co **and** a warm auto-reply to the customer ("here's what happens next")
- [ ] Admin: inquiries appear in Moksh Diam OS (list + detail, like Applications)

**Done when:** a first-time visitor completes an inquiry on a phone in under 3 minutes.

---

## Phase 2 — Payments ("easy payment flow")

Bespoke pricing means payment links, not a cart. Stripe Checkout (hosted) does
all the heavy lifting — no card data ever touches our server.

Money flow: **design fee → 50% production deposit → balance before shipping.**

- [ ] From the admin, generate a Stripe Checkout link for any order + milestone
      (design fee / deposit / balance) — one click, emailed automatically
- [ ] Stripe webhook → marks the milestone paid on the order, triggers receipt +
      status advance (e.g. deposit paid → `in_production` eligible)
- [ ] Payment status visible on the order in admin and on the customer tracking page
- [ ] Later (Phase 4): fixed-price "Signature Collection" pieces with direct Buy buttons

**Done when:** zero manual invoicing — every payment updates the order on its own.

---

## Phase 3 — Order tracking ("track orders easy")

Two sides — the admin already exists; the customer side is new.

**Architecture decision (proposed):** retail orders live in the same Supabase
`b2b_orders` table with a `channel = 'retail'` column, reusing `VALID_TRANSITIONS`,
status history, and the Moksh Diam OS admin UI. One pipeline, two channels.
(Alternative: separate `retail_orders` table — cleaner separation, double the admin work.)

- [ ] Customer tracking page on azoir.co: magic link by email (no password) →
      timeline view — *Sketch → Design → CAD → Production → QC → Shipped* —
      with dates, photos of work-in-progress, and carrier tracking once shipped
- [ ] Email on every status change ("Your ring just entered production ✨")
- [ ] Admin: filter by channel in Moksh Diam OS orders/production views

**Done when:** "where's my ring?" is answered by a link, not a support email.

---

## Phase 4 — Store polish & growth

- [ ] **Photography sprint** — the single biggest blocker; the gallery currently
      recycles 4 renders. Every real commission should feed the gallery.
- [ ] Real testimonials + FAQ page
- [ ] Pricing anchors on commission page ("bands from $900, engagement from $2,500…")
- [ ] Signature Collection: 3–6 ready-to-order pieces at fixed prices (uses Phase 2 rails)
- [ ] SEO content: "how a bespoke ring is made", stone guides
- [ ] Live Instagram/TikTok links (footer links are currently decorative)

---

## Sequence & effort (rough)

| Phase | Effort | Unblocks |
|---|---|---|
| 0 Foundations | ~1 session | credibility, measurement |
| 1 Inquiry wizard | 2–3 sessions | lead quality + volume |
| 2 Payments | 2 sessions | revenue without admin toil |
| 3 Tracking | 2 sessions | support-free order lifecycle |
| 4 Polish/growth | ongoing | conversion, repeat business |

Phases 1–3 are independent enough to reorder, but 2 before 3 makes tracking
richer (payment milestones on the timeline).

## Open decisions

1. **Reuse Moksh Diam OS + `b2b_orders` (channel column) for retail orders?** — proposed yes
2. **Design-fee amount & whether it credits toward the final price** — business call
3. **Magic-link tracking vs. full customer accounts** — proposed magic links (no passwords, no account management)
4. **Analytics: Plausible (private, paid) vs GA4 (free)** 
