// Azoir & Co. — retail site server (static pages + paid commission inquiry)
import express from "express";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);
app.use(express.urlencoded({ extended: true, limit: "256kb" }));

// Redirect www → apex (301, preserves path)
app.use((req, res, next) => {
  const host = req.headers.host || "";
  if (host.startsWith("www.")) {
    return res.redirect(301, `https://${host.slice(4)}${req.originalUrl}`);
  }
  next();
});

const WEB = path.join(__dirname, "web");
const INQUIRY_TO = process.env.INQUIRY_EMAIL || "hello@azoir.co";
const INQUIRY_FROM = process.env.INQUIRY_FROM || "Azoir & Co <hello@azoir.co>";

// ── Bot defense ──────────────────────────────────────────────────────────────
// Bots were submitting the commission form with strangers' emails; the warm
// auto-reply below made Resend mail each one a "confirmation" — a spam relay
// with our domain's reputation on the line. Three layers, cheapest first:
// honeypot, minimum fill time (wizard.js stamps fg_ts at page load; a direct
// POST has none), per-IP sliding-window rate limit. Caught bots get the same
// /thanks.html redirect a human gets — with no email and no database row —
// because a bot that believes it succeeded stops probing.
const MIN_FILL_MS = 4_000;
const MAX_AGE_MS = 6 * 60 * 60 * 1000;
const WINDOW_MS = 10 * 60 * 1000, MAX_PER_WINDOW = 3;
const DAY_MS = 24 * 60 * 60 * 1000, MAX_PER_DAY = 8;
const hits = new Map();

function botVerdict(req) {
  if (String(req.body?.website_url || "").trim() !== "") return "honeypot";
  const ts = Number(req.body?.fg_ts);
  if (!Number.isFinite(ts) || ts <= 0) return "no_ts";
  const age = Date.now() - ts;
  if (age < MIN_FILL_MS) return "too_fast";
  if (age > MAX_AGE_MS) return "stale";
  const ip = req.ip || "unknown";
  const now = Date.now();
  const seen = (hits.get(ip) || []).filter((t) => now - t < DAY_MS);
  if (seen.filter((t) => now - t < WINDOW_MS).length >= MAX_PER_WINDOW || seen.length >= MAX_PER_DAY) {
    return "rate_limited";
  }
  seen.push(now);
  hits.set(ip, seen);
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (v.every((t) => now - t > DAY_MS)) hits.delete(k);
  }
  return null;
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const clean = (s) => String(s || "").slice(0, 4000).trim();

// ── Design fee gate ──────────────────────────────────────────────────────────
// Spam still got past the bot gate, so a request now reaches the atelier only
// once its $60 design fee is paid. The brief rides to Stripe in the Checkout
// Session's metadata, so a request that never pays is never stored or emailed.
// Delivery runs from the success redirect and from the webhook (the safety
// net for a closed tab); the unique stripe_session_id on retail_inquiries
// turns whichever lands second into a no-op.
const DESIGN_FEE_CENTS = 6000;
// metadata.mode — Moksh Diam's Stripe webhook may see these sessions too; it
// acts only on its own modes.
const FEE_MODE = "azoir_inquiry";
const FIELDS = ["type", "metal", "stone", "budget", "timeline", "message", "name", "email", "phone"];
// Stripe caps a metadata value at 500 chars; 250 code points never exceeds it
// and never splits an emoji. A 4000-char story is at most 16 chunks.
const CHUNK = 250;

async function stripe(endpoint, params) {
  const r = await fetch(`https://api.stripe.com/v1/${endpoint}`, {
    method: params ? "POST" : "GET",
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
    body: params ? new URLSearchParams(params) : undefined,
  });
  const body = await r.json();
  if (!r.ok) throw Object.assign(new Error(`stripe ${r.status}: ${body.error?.message}`), { code: body.error?.code, param: body.error?.param });
  return body;
}

function briefToMetadata(f) {
  const meta = { mode: FEE_MODE };
  for (const k of FIELDS) {
    const chars = Array.from(clean(f[k]));
    if (k === "message") {
      for (let i = 0; i * CHUNK < chars.length; i++) meta[`message_${i}`] = chars.slice(i * CHUNK, (i + 1) * CHUNK).join("");
    } else if (chars.length) {
      meta[k] = chars.slice(0, CHUNK).join("");
    }
  }
  return meta;
}

function metadataToBrief(meta) {
  const f = {};
  for (const k of FIELDS) f[k] = meta[k] || "";
  for (let i = 0; meta[`message_${i}`]; i++) f.message += meta[`message_${i}`];
  return f;
}

// Stripe-Signature is `t=<unix>,v1=<hex HMAC of "t.body">[,v1=…]`; five-minute
// tolerance, as in Stripe's own SDK.
function verifyStripeEvent(raw, header, secret) {
  if (!secret || !Buffer.isBuffer(raw)) return null;
  const pairs = String(header || "").split(",").map((p) => p.split("="));
  const t = pairs.find(([k]) => k === "t")?.[1];
  if (!(Math.abs(Date.now() / 1000 - Number(t)) <= 300)) return null;
  const expected = crypto.createHmac("sha256", secret).update(`${t}.`).update(raw).digest();
  const ok = pairs.some(([k, v]) => {
    if (k !== "v1") return false;
    const got = Buffer.from(v || "", "hex");
    return got.length === expected.length && crypto.timingSafeEqual(got, expected);
  });
  return ok ? JSON.parse(raw.toString("utf8")) : null;
}

// Persist an inquiry to the shared Supabase (retail_inquiries). Returns false
// only when this Stripe session is already recorded; an unset env or a failed
// write returns true so the email safety net still fires.
async function saveInquiry(record) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.log("[inquiry] Supabase env unset — not persisted (email still sent)"); return true; }
  const r = await fetch(`${url}/rest/v1/retail_inquiries?on_conflict=stripe_session_id&select=id`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation,resolution=ignore-duplicates",
    },
    body: JSON.stringify(record),
  });
  if (!r.ok) { console.error("[inquiry] supabase insert failed", r.status, await r.text()); return true; }
  return (await r.json()).length > 0;
}

// Email the brief to the atelier, then a warm auto-reply to the customer.
async function sendInquiryEmails(f, session) {
  const name = f.name;
  const email = f.email;

  const rows = [
    ["Piece", f.type],
    ["Name", name],
    ["Email", email],
    ["Phone", f.phone],
    ["Budget", f.budget],
    ["Timeline", f.timeline],
    ["Metal", f.metal],
    ["Stone", f.stone],
    ["Message", f.message],
    ["Design fee", `$${(session.amount_total / 100).toFixed(2)} paid — Stripe ${session.payment_intent}`],
  ].filter(([, v]) => clean(v));

  const text = rows.map(([k, v]) => `${k}: ${clean(v)}`).join("\n");
  const html =
    `<h2 style="font-family:Georgia,serif">New commission inquiry</h2>` +
    rows.map(([k, v]) => `<p><strong>${k}:</strong> ${escapeHtml(clean(v)).replace(/\n/g, "<br>")}</p>`).join("");

  async function send(payload) {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) console.error("[inquiry] resend failed", r.status, await r.text());
    return r.ok;
  }

  const firstName = name.split(/\s+/)[0];
  const arText =
    `Thank you, ${firstName}.\n\n` +
    `We've received your commission inquiry and design fee, and it's with our atelier. A designer will personally reply within one business day to begin the conversation — no obligation, just possibilities.\n\n` +
    `In the meantime, feel free to gather any inspiration — a stone you love, a piece you've seen, a photo of something meaningful. You'll be able to share it with us once we're in touch.\n\n` +
    `With care,\nAzoir & Co. · New York\nhello@azoir.co`;
  const p = 'font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.7;color:#475569';
  const arHtml =
    `<div style="max-width:520px;margin:0 auto">` +
    `<p style="font-family:Georgia,serif;font-size:20px;color:#18181B">Thank you, ${escapeHtml(firstName)}.</p>` +
    `<p style="${p}">We've received your commission inquiry and design fee, and it's with our atelier. A designer will personally reply within one business day to begin the conversation — no obligation, just possibilities.</p>` +
    `<p style="${p}">In the meantime, feel free to gather any inspiration — a stone you love, a piece you've seen, a photo of something meaningful. You'll be able to share it with us once we're in touch.</p>` +
    `<p style="${p}">With care,<br><strong style="color:#18181B">Azoir &amp; Co.</strong> · New York</p>` +
    `</div>`;

  try {
    if (process.env.RESEND_API_KEY) {
      await send({
        from: INQUIRY_FROM, to: [INQUIRY_TO], reply_to: email,
        subject: `Commission inquiry — ${name}${f.type ? ` (${clean(f.type)})` : ""}`,
        text, html,
      });
      // Warm auto-reply to the customer — non-fatal if it fails
      try {
        await send({
          from: INQUIRY_FROM, to: [email],
          subject: "We've received your inquiry — Azoir & Co.",
          text: arText, html: arHtml,
        });
      } catch (e) { console.error("[inquiry] auto-reply error", e); }
    } else {
      console.log("[inquiry] RESEND_API_KEY unset — inquiry logged only:\n" + text);
    }
  } catch (err) {
    console.error("[inquiry] send error", err);
    // Never lose the lead — log it and still thank the customer
    console.log("[inquiry] payload:\n" + text);
  }
}

// Sessions this process has delivered — the dedupe for when the Supabase write
// fails and the unique index can't (a replayed /inquiry/paid would otherwise
// send another pair of emails each time).
const delivered = new Set();

// Record a paid request once and email it. Both the success redirect and the
// webhook call this; anything but a paid azoir inquiry session is ignored.
async function deliverInquiry(session) {
  if (session.metadata?.mode !== FEE_MODE || session.payment_status !== "paid") return;
  if (delivered.has(session.id)) return;
  delivered.add(session.id); // before any await, so a concurrent redirect + webhook can't both pass
  const f = metadataToBrief(session.metadata);
  // Persist the lead first (email is the safety net if this fails)
  let isNew = true;
  try {
    isNew = await saveInquiry({
      name: f.name, email: f.email,
      phone: f.phone || null,
      type: f.type || null,
      metal: f.metal || null,
      stone: f.stone || null,
      budget: f.budget || null,
      timeline: f.timeline || null,
      message: f.message || null,
      source: "azoir.co",
      design_fee_cents: session.amount_total,
      design_fee_paid_at: new Date().toISOString(),
      stripe_session_id: session.id,
    });
  } catch (e) { console.error("[inquiry] save error", e); }
  if (isNew) await sendInquiryEmails(f, session);
}

app.get("/health", (_req, res) => res.send("ok"));

// Static assets (media incl. hero.mp4 lives under web/media)
app.use(express.static(WEB, { extensions: ["html"], maxAge: "1h" }));

// Commission inquiry — send the customer to Stripe for the design fee. Nothing
// is stored or emailed here; deliverInquiry does that once it's paid.
app.post("/inquiry", async (req, res) => {
  const f = req.body || {};
  const name = clean(f.name);
  const email = clean(f.email);

  // Bot gate — before any Stripe call. Only a bot fills the honeypot or posts
  // without the wizard's stamp; those get the fake success page. Too fast, stale
  // or rate limited can be a person retrying after leaving the checkout, so they
  // go back to the form with their answers — the fee is the real barrier now.
  const verdict = botVerdict(req);
  if (verdict) {
    console.log(`[inquiry] bot dropped (${verdict}) ip=${req.ip}`);
    return res.redirect(verdict === "honeypot" || verdict === "no_ts" ? "/thanks.html" : "/commission.html?error=busy");
  }

  if (!name || !email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.redirect("/commission.html?error=1");
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    console.error("[inquiry] STRIPE_SECRET_KEY unset — cannot take the design fee");
    return res.redirect("/commission.html?error=payment");
  }

  const origin = `${req.protocol}://${req.get("host")}`;
  const params = {
    mode: "payment",
    // Card settles at checkout, so a completed session is always a paid one.
    "payment_method_types[0]": "card",
    customer_email: email,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(DESIGN_FEE_CENTS),
    "line_items[0][price_data][product_data][name]": "Design fee — commission request",
    success_url: `${origin}/inquiry/paid?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/commission.html?fee=cancelled`,
  };
  for (const [k, v] of Object.entries(briefToMetadata(f))) params[`metadata[${k}]`] = v;

  try {
    const session = await stripe("checkout/sessions", params);
    res.redirect(303, session.url);
  } catch (e) {
    console.error("[inquiry] checkout error", e);
    // An address our regex passes but Stripe rejects needs fixing, not retrying.
    res.redirect(e.code === "email_invalid" || e.param === "customer_email" ? "/commission.html?error=1" : "/commission.html?error=payment");
  }
});

// Stripe success redirect. A failed lookup still thanks the customer — the
// webhook delivers a paid request regardless.
app.get("/inquiry/paid", async (req, res) => {
  const id = String(req.query.session_id || "");
  if (!/^cs_\w+$/.test(id)) return res.redirect("/commission.html");
  try {
    const session = await stripe(`checkout/sessions/${id}`);
    if (session.payment_status !== "paid") return res.redirect("/commission.html?fee=cancelled");
    await deliverInquiry(session);
  } catch (e) {
    console.error("[inquiry] confirm error", e);
  }
  res.redirect("/thanks.html");
});

// Stripe webhook (checkout.session.completed) — delivers a paid request whose
// customer closed the tab before the success redirect. A 500 makes Stripe retry.
app.post("/webhooks/stripe", express.raw({ type: "application/json" }), async (req, res) => {
  const event = verifyStripeEvent(req.body, req.get("stripe-signature"), process.env.STRIPE_WEBHOOK_SECRET);
  if (!event) return res.status(400).send("invalid signature");
  try {
    if (event.type === "checkout.session.completed") await deliverInquiry(event.data.object);
  } catch (e) {
    console.error("[webhook] delivery error", e);
    return res.status(500).send("error");
  }
  res.json({ received: true });
});

app.use((_req, res) => res.status(404).sendFile(path.join(WEB, "404.html")));

const port = Number(process.env.PORT) || 3000;
app.listen(port, "0.0.0.0", () => console.log(`Azoir site on http://0.0.0.0:${port}`));
