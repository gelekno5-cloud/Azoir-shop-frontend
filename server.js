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

// Persist an inquiry to the shared Supabase (retail_inquiries). Returns true
// when inserted, false when this Stripe session is already recorded, and null
// when unset or failed — the email safety net still fires then.
async function saveInquiry(record) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.log("[inquiry] Supabase env unset — not persisted (email still sent)"); return null; }
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
  if (!r.ok) { console.error("[inquiry] supabase insert failed", r.status, await r.text()); return null; }
  return (await r.json()).length > 0;
}

// Email the brief to the atelier, then a warm auto-reply to the customer.
// Returns whether the brief reached the atelier (or the log, with Resend unset).
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
    `Your $60 design fee is credited toward your piece's final price.\n\n` +
    `In the meantime, feel free to gather any inspiration — a stone you love, a piece you've seen, a photo of something meaningful. You'll be able to share it with us once we're in touch.\n\n` +
    `With care,\nAzoir & Co. · New York\nhello@azoir.co`;
  const p = 'font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.7;color:#475569';
  const arHtml =
    `<div style="max-width:520px;margin:0 auto">` +
    `<p style="font-family:Georgia,serif;font-size:20px;color:#18181B">Thank you, ${escapeHtml(firstName)}.</p>` +
    `<p style="${p}">We've received your commission inquiry and design fee, and it's with our atelier. A designer will personally reply within one business day to begin the conversation — no obligation, just possibilities.</p>` +
    `<p style="${p}">Your $60 design fee is credited toward your piece's final price.</p>` +
    `<p style="${p}">In the meantime, feel free to gather any inspiration — a stone you love, a piece you've seen, a photo of something meaningful. You'll be able to share it with us once we're in touch.</p>` +
    `<p style="${p}">With care,<br><strong style="color:#18181B">Azoir &amp; Co.</strong> · New York</p>` +
    `</div>`;

  try {
    if (process.env.RESEND_API_KEY) {
      const sent = await send({
        from: INQUIRY_FROM, to: [INQUIRY_TO], reply_to: email,
        subject: `Commission inquiry — ${name}${f.type ? ` (${clean(f.type)})` : ""}`,
        text, html,
      });
      if (!sent) console.log("[inquiry] payload:\n" + text);
      // Warm auto-reply to the customer — non-fatal if it fails
      try {
        await send({
          from: INQUIRY_FROM, to: [email],
          subject: "We've received your inquiry — Azoir & Co.",
          text: arText, html: arHtml,
        });
      } catch (e) { console.error("[inquiry] auto-reply error", e); }
      return sent;
    }
    console.log("[inquiry] RESEND_API_KEY unset — inquiry logged only:\n" + text);
    return true;
  } catch (err) {
    console.error("[inquiry] send error", err);
    // Never lose the lead — log it and still thank the customer
    console.log("[inquiry] payload:\n" + text);
    return false;
  }
}

// ── Wedding band requests ────────────────────────────────────────────────────
// A band designed in the builder (wedding-bands.html) and reserved with a
// deposit by card. The row goes into the shared Supabase (band_orders,
// migrations 2026-10-17 and 2026-10-18 in the Moksh Diam repo) as
// pending_payment BEFORE the customer sees Stripe, so the spec never has to
// fit in Stripe's metadata; the success redirect and the webhook both mark it
// deposit_paid, and the compare-and-set on status makes whichever lands second
// a no-op. The atelier confirms the final price and collects the balance from
// Moksh Diam under /app/band-orders.
//
// The estimate is recomputed here from the spec's per-zone weights and the
// atelier's rates — the browser's number is never charged. The weights come
// from the browser's 3D model, so they're bounded against the ring's
// bounding annulus (a band is at least ~45% of it and never above it by much)
// and the bench confirms the weight before casting. Diamonds and platinum
// have no estimate (quoteNeeded): the deposit is the flat minimum and the
// price is quoted by the atelier.
const BAND_MODE = "azoir_band";
const BAND_DEPOSIT_MIN_CENTS = 25000;                  // $250 floor, and the flat deposit when there is no estimate
const BAND_DEPOSIT_RATE = 0.25;                        // of the estimate (owner, 2026-10-17)
const bandDepositCents = (estimateCents) => estimateCents == null ? BAND_DEPOSIT_MIN_CENTS : Math.max(BAND_DEPOSIT_MIN_CENTS, Math.round(estimateCents * BAND_DEPOSIT_RATE));
const BAND_LABOR_CENTS = 10000;                        // per band (owner, 2026-10-17)
const BAND_RATES = { "14y": 12000, "14w": 12000, "14r": 12000, "18y": 15400, "18w": 15400, "18r": 15400, pt: null }; // cents per gram; null = quoted
const BAND_DENSITY = { "14y": 13.1, "14w": 12.7, "14r": 13.0, "18y": 15.5, "18w": 15.1, "18r": 15.2, pt: 20.6 };
const BAND_SHIP_COUNTRIES = ["US", "CA", "GB"];
const ADMIN_URL = (process.env.ADMIN_URL || "https://mokshdiam.com").replace(/\/+$/, "");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Supabase REST with the service role. Returns parsed JSON (or null) and the status. */
async function sb(pathAndQuery, { method = "GET", body, prefer } = {}) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("supabase env unset");
  const r = await fetch(`${url}/rest/v1/${pathAndQuery}`, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw Object.assign(new Error(`supabase ${r.status}: ${text.slice(0, 300)}`), { status: r.status });
  return text ? JSON.parse(text) : null;
}

const num = (v, lo, hi) => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
const str = (v, max) => (typeof v === "string" && v.length <= max ? v : null);

/**
 * Check the builder's spec JSON and price it. Returns { spec, metalCents, laborCents, summary, quoteNeeded }
 * or { reject: "invalid" | "weight" }. quoteNeeded = diamonds or an unpriced metal (platinum): the
 * structure is still validated, metalCents covers only the priced zones, and the atelier quotes the price.
 */
function priceBandSpec(raw) {
  if (typeof raw !== "string" || raw.length > 40000) return { reject: "invalid" };
  let spec;
  try { spec = JSON.parse(raw); } catch { return { reject: "invalid" }; }
  if (!spec || spec.version !== 2 || !Array.isArray(spec.bands) || spec.bands.length < 1 || spec.bands.length > 2) return { reject: "invalid" };
  if (!/^AZB-[A-Z2-9]{6}$/.test(String(spec.ref || ""))) return { reject: "invalid" };
  const pair = spec.bands.length === 2;
  if (!!spec.pair !== pair) return { reject: "invalid" };
  let metalCents = 0, quoteNeeded = false;
  const summary = [];
  for (const b of spec.bands) {
    if (!b || typeof b !== "object") return { reject: "invalid" };
    const width = num(b.widthMm, 1.5, 12), depth = num(b.depthMm, 0.8, 4), us = num(b.size && b.size.us, 2, 16), grams = num(b.weightG, 0.2, 120);
    if (width == null || depth == null || us == null || grams == null || !Array.isArray(b.zones) || b.zones.length < 1 || b.zones.length > 3) return { reject: "invalid" };
    if (!b.profile || !str(b.profile.key, 20) || !str(b.profile.name, 40)) return { reject: "invalid" };
    if (b.engraving && (!str(b.engraving.text, 30) || !str(b.engraving.style, 20))) return { reject: "invalid" };
    if (b.stones) {
      if (typeof b.stones !== "object" || Array.isArray(b.stones)) return { reject: "invalid" };
      quoteNeeded = true;
    }
    let zoneGrams = 0, boundDensity = 0;
    for (const z of b.zones) {
      if (!z || !(z.metal in BAND_RATES) || !str(z.metalName, 40) || !str(z.finishName, 40)) return { reject: "invalid" };
      const g = num(z.weightG, 0, 120);
      if (g == null) return { reject: "invalid" };
      if (BAND_RATES[z.metal] == null) quoteNeeded = true;
      zoneGrams += g;
      boundDensity = Math.max(boundDensity, BAND_DENSITY[z.metal]);
      metalCents += g * (BAND_RATES[z.metal] || 0);
    }
    if (Math.abs(zoneGrams - grams) > Math.max(0.3, grams * 0.05)) return { reject: "invalid" };
    // Bounding annulus of the ring, in mm³ → g at the densest zone's density.
    const ri = (11.66 + 0.811 * us) / 2;
    const boxGrams = Math.PI * ((ri + depth) ** 2 - ri ** 2) * width / 1000 * boundDensity;
    if (grams < boxGrams * 0.45 || grams > boxGrams * 1.35) return { reject: "weight" };
    summary.push(`${b.zones[0].metalName}${b.zones.length > 1 ? ` + ${b.zones.length - 1}` : ""} · ${b.profile.name} ${width} mm · US ${us}${b.stones ? " · diamonds" : ""}`);
  }
  metalCents = Math.round(metalCents);
  return { spec, metalCents, laborCents: BAND_LABOR_CENTS * spec.bands.length, quoteNeeded, summary: pair ? summary.map((t, i) => `${spec.bands[i].label || ["Hers", "His"][i]}: ${t}`).join(" · ") : summary[0] };
}

/** The deposit terms of a saved request, from spec.deposit (written by /band-request) with safe fallbacks. */
function bandDepositOf(order) {
  const d = (order.spec && order.spec.deposit) || {};
  const quoteNeeded = !!d.quoteNeeded;
  const estimateCents = quoteNeeded ? null : Number.isFinite(d.estimateCents) ? d.estimateCents : order.subtotal_cents + (order.shipping_cents || 0);
  const depositCents = Number.isFinite(d.depositCents) ? d.depositCents : bandDepositCents(estimateCents);
  return { quoteNeeded, estimateCents, depositCents, balanceCents: estimateCents == null ? null : Math.max(0, estimateCents - depositCents), notes: typeof d.notes === "string" ? d.notes : "" };
}

/** Honeypot, the builder's page stamp (≥ 4 s old) and the per-IP window — no max age: people design for hours. */
function bandBotVerdict(req) {
  if (String(req.body?.website_url || "").trim() !== "") return "honeypot";
  const ts = Number(req.body?.fg_ts);
  if (!Number.isFinite(ts) || ts <= 0) return "no_ts";
  if (Date.now() - ts < MIN_FILL_MS) return "too_fast";
  const ip = req.ip || "unknown", now = Date.now();
  const seen = (hits.get(ip) || []).filter((t) => now - t < DAY_MS);
  if (seen.filter((t) => now - t < WINDOW_MS).length >= MAX_PER_WINDOW || seen.length >= MAX_PER_DAY) return "rate_limited";
  seen.push(now); hits.set(ip, seen);
  return null;
}

async function bandEvent(orderId, kind, actor, extra = {}) {
  try {
    await sb("band_order_events", { method: "POST", body: { order_id: orderId, kind, actor, from_status: extra.from ?? null, to_status: extra.to ?? null, note: extra.note ?? null, data: extra.data ?? {} } });
  } catch (e) { console.error("[band] event failed", e.message); }
}

const money = (cents) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function shipToText(ship) {
  if (!ship) return "";
  const a = ship.address || {};
  return [ship.name, a.line1, a.line2, [a.city, [a.state, a.postal_code].filter(Boolean).join(" ")].filter(Boolean).join(", "), a.country].filter(Boolean).join("\n");
}

async function sendBandOrderEmails(order, session) {
  const summary = order.spec?.bands ? priceBandSpec(JSON.stringify(order.spec)).summary || "Wedding band" : "Wedding band";
  const ship = shipToText(order.ship_to);
  const dep = bandDepositOf(order);
  const paid = Number.isFinite(session.amount_total) ? session.amount_total : dep.depositCents;
  const priceLine = dep.quoteNeeded
    ? "Price: to be quoted (diamonds or platinum) — the deposit is the flat minimum"
    : `Estimate: ${money(dep.estimateCents)} (estimate only) · balance ≈ ${money(dep.balanceCents)} after the price is confirmed`;
  const designLink = order.design_url;
  const adminLink = `${ADMIN_URL}/app/band-orders/${order.id}`;
  const text =
    `Request: ${order.order_number}\nDesign: ${order.design_ref}\nBand: ${summary}\nDeposit: ${money(paid)} paid by card (Stripe ${session.payment_intent})\n${priceLine}\n` +
    `Customer: ${order.customer_name || "—"} <${order.email}>${order.phone ? ` · ${order.phone}` : ""}\n${dep.notes ? `Notes: ${dep.notes}\n` : ""}${ship ? `Ship to:\n${ship}\n` : ""}\n` +
    `Next: confirm the size and the final price with the customer, then collect the balance before production.\n` +
    `Open in Moksh Diam: ${adminLink}\nOpen the design: ${designLink}\n\n${order.spec_text || ""}`;
  const esc = escapeHtml;
  const html =
    `<h2 style="font-family:Georgia,serif">Wedding band request — ${esc(order.order_number)}</h2>` +
    `<p><strong>Band:</strong> ${esc(summary)}<br><strong>Deposit:</strong> ${money(paid)} paid by card<br><strong>${esc(priceLine.split(":")[0])}:</strong> ${esc(priceLine.split(/:\s*/).slice(1).join(": "))}<br>` +
    `<strong>Customer:</strong> ${esc(order.customer_name || "—")} &lt;${esc(order.email || "")}&gt;${order.phone ? ` · ${esc(order.phone)}` : ""}</p>` +
    (dep.notes ? `<p><strong>Notes:</strong><br>${esc(dep.notes).replace(/\n/g, "<br>")}</p>` : "") +
    (ship ? `<p><strong>Ship to:</strong><br>${esc(ship).replace(/\n/g, "<br>")}</p>` : "") +
    `<p>Next: confirm the size and the final price with the customer, then collect the balance before production.</p>` +
    `<p><a href="${esc(adminLink)}">Open in Moksh Diam</a> · <a href="${esc(designLink)}">Open the design</a></p>` +
    `<pre style="font:13px/1.5 -apple-system,Segoe UI,sans-serif;white-space:pre-wrap">${esc(order.spec_text || "")}</pre>`;
  const first = String(order.customer_name || "").split(/\s+/)[0];
  const p = "font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.7;color:#475569;margin:0 0 14px";
  const custPrice = dep.quoteNeeded
    ? "Because your design includes diamonds or platinum, a designer will quote the final price for you before anything is made."
    : `Your current estimate is ${money(dep.estimateCents)} — an estimate, not a final price. Once a designer confirms the price with you, we invoice the balance (about ${money(dep.balanceCents)}) before production begins.`;
  const arHtml =
    `<div style="max-width:520px;margin:0 auto">` +
    `<p style="font-family:Georgia,serif;font-size:22px;color:#18181B">Thank you${first ? `, ${esc(first)}` : ""}.</p>` +
    `<p style="${p}">Your deposit of <strong>${money(paid)}</strong> is received and your request <strong>${esc(order.order_number)}</strong> is with our New York atelier: ${esc(summary)}.</p>` +
    `<p style="${p}">${esc(custPrice)}</p>` +
    `<p style="${p}">A designer will be in touch within one business day to confirm the size and the specification. Your deposit is applied to the final price and is refundable until you approve the final design. Your design stays at <a href="${esc(designLink)}" style="color:#18181B">${esc(order.design_ref)}</a>.</p>` +
    `<p style="${p}">With care,<br><strong style="color:#18181B">Azoir &amp; Co.</strong> · New York</p></div>`;
  const arText = `Thank you${first ? `, ${first}` : ""}.\n\nYour deposit of ${money(paid)} is received and your request ${order.order_number} is with our New York atelier: ${summary}.\n\n${custPrice}\n\nA designer will be in touch within one business day to confirm the size and the specification. Your deposit is applied to the final price and is refundable until you approve the final design. Your design: ${designLink}\n\nWith care,\nAzoir & Co. · New York\nhello@azoir.co`;
  if (!process.env.RESEND_API_KEY) { console.log("[band] RESEND_API_KEY unset — request logged only:\n" + text); return { atelier: true, customer: false }; }
  const send = async (payload) => {
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!r.ok) console.error("[band] resend failed", r.status, await r.text());
    return r.ok;
  };
  let atelier = false, customer = false;
  try {
    atelier = await send({ from: INQUIRY_FROM, to: [INQUIRY_TO], reply_to: order.email || undefined, subject: `Band request ${order.order_number} — ${money(paid)} deposit paid${dep.quoteNeeded ? " · quote needed" : ""}`, text, html });
    if (!atelier) console.log("[band] payload:\n" + text);
    if (order.email) customer = await send({ from: INQUIRY_FROM, to: [order.email], subject: `Your wedding band request ${order.order_number} — Azoir & Co.`, text: arText, html: arHtml });
  } catch (e) { console.error("[band] send error", e); console.log("[band] payload:\n" + text); }
  return { atelier, customer };
}

/** Mark a paid session's request deposit_paid, once, then tell the atelier and the customer. */
async function deliverBandOrder(session) {
  if (session.metadata?.mode !== BAND_MODE || session.payment_status !== "paid") return;
  const id = String(session.metadata.band_order_id || "");
  if (!UUID.test(id)) { console.error("[band] paid session without an order id", session.id); return; }
  const cd = session.customer_details || {};
  const shipping = session.shipping_details || session.collected_information?.shipping_details || null;
  const now = new Date().toISOString();
  // Keys left undefined are dropped by JSON.stringify, so the form's name/email/phone
  // stay unless Stripe collected something.
  const patch = {
    status: "deposit_paid", paid_at: now, updated_at: now,
    stripe_payment_intent: typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || null,
    stripe_checkout_session_id: session.id,
    email: cd.email || undefined, customer_name: (shipping && shipping.name) || cd.name || undefined, phone: cd.phone || undefined,
    ship_to: shipping ? { name: shipping.name || null, address: shipping.address || null } : undefined,
  };
  const rows = await sb(`band_orders?id=eq.${id}&status=eq.pending_payment`, { method: "PATCH", body: patch, prefer: "return=representation" });
  if (!rows || rows.length === 0) {
    // Already delivered — or cancelled by the admin after the customer had paid.
    const cur = await sb(`band_orders?id=eq.${id}&select=status,order_number`);
    if (cur && cur[0] && cur[0].status === "cancelled") {
      await bandEvent(id, "paid", "stripe", { note: "Deposit paid after the request was cancelled — refund due", data: { payment_intent: patch.stripe_payment_intent, amount_total: session.amount_total } });
      await sb("b2b_admin_notifications", { method: "POST", body: { type: "band_order", message: `Band request ${cur[0].order_number} was paid after it was cancelled (${patch.stripe_payment_intent}) — refund it from /app/band-orders.` } }).catch(() => {});
    }
    return;
  }
  const order = rows[0];
  const dep = bandDepositOf(order);
  const paid = Number.isFinite(session.amount_total) ? session.amount_total : dep.depositCents;
  // Deposit columns arrive with the 2026-10-18 migration; until it runs this
  // PATCH fails and the deposit is still readable from spec.deposit.
  await sb(`band_orders?id=eq.${id}`, { method: "PATCH", body: { deposit_cents: paid, balance_cents: dep.balanceCents, quote_needed: dep.quoteNeeded } })
    .catch((e) => console.error("[band] deposit columns not written (migration pending?)", e.message));
  await bandEvent(id, "paid", "stripe", { from: "pending_payment", to: "deposit_paid", note: `Deposit ${money(paid)}${dep.quoteNeeded ? " · price to be quoted" : ` · balance ≈ ${money(dep.balanceCents)}`}`, data: { payment_intent: patch.stripe_payment_intent, amount_total: session.amount_total, deposit_cents: paid, balance_cents: dep.balanceCents, quote_needed: dep.quoteNeeded } });
  const sent = await sendBandOrderEmails(order, session);
  await bandEvent(id, "email", "system", { data: { template: "deposit_confirmation", sent: sent.customer } });
  try {
    const tail = dep.quoteNeeded ? "price to be quoted" : `estimate ${money(dep.estimateCents)}, balance ≈ ${money(dep.balanceCents)}`;
    await sb("b2b_admin_notifications", { method: "POST", body: { type: "band_order", message: `New band request ${order.order_number} — ${money(paid)} deposit paid (${tail}). Confirm the price from /app/band-orders.` } });
  } catch (e) { console.error("[band] admin notification failed", e.message); }
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
  let saved = null;
  try {
    saved = await saveInquiry({
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
  if (saved === false) return; // already recorded — delivered before
  const emailed = await sendInquiryEmails(f, session);
  if (!saved && !emailed) {
    // Neither the row nor the atelier email landed: forget the session so the
    // webhook's retry (it answers 500) or a replayed redirect can deliver it.
    delivered.delete(session.id);
    throw new Error(`inquiry ${session.id} not delivered`);
  }
}

app.get("/health", (_req, res) => res.send("ok"));

// Static assets (media incl. hero.mp4 lives under web/media)
// Pages revalidate on every visit (a deploy must show up at once); assets keep the hour.
app.use(express.static(WEB, {
  extensions: ["html"],
  maxAge: "1h",
  setHeaders(res, filePath) {
    if (filePath.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
  },
}));

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
    "line_items[0][price_data][product_data][description]": "Credited toward your final price. Non-refundable, as it covers design work.",
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

// Band request — price the spec, save it as pending with the customer's details,
// send the customer to Stripe for the deposit only. The balance is collected by
// the atelier once the final price is confirmed. /band-order is the old name.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
async function bandRequest(req, res) {
  const back = (q) => res.redirect(`/wedding-bands.html?order=${q}`);
  const verdict = bandBotVerdict(req);
  if (verdict) {
    console.log(`[band] bot dropped (${verdict}) ip=${req.ip}`);
    return verdict === "honeypot" || verdict === "no_ts" ? res.redirect("/band-thanks.html") : back("busy");
  }
  const priced = priceBandSpec(req.body?.spec);
  if (priced.reject) {
    console.log(`[band] spec rejected (${priced.reject}) ip=${req.ip}`);
    return back(priced.reject === "weight" ? "weight" : "error");
  }
  const name = clean(req.body?.name).slice(0, 120), email = clean(req.body?.email).slice(0, 200).toLowerCase();
  const phone = clean(req.body?.phone).slice(0, 40) || null, notes = clean(req.body?.notes).slice(0, 2000);
  if (!name || !EMAIL_RE.test(email)) return back("fields");
  if (!process.env.STRIPE_SECRET_KEY) { console.error("[band] STRIPE_SECRET_KEY unset"); return back("error"); }
  const { spec, metalCents, laborCents, summary, quoteNeeded } = priced;
  const estimateCents = quoteNeeded ? null : metalCents + laborCents;
  const depositCents = bandDepositCents(estimateCents);
  const balanceCents = estimateCents == null ? null : Math.max(0, estimateCents - depositCents);
  // What the browser showed is not trusted for the charge, but a mismatch is worth a log line.
  const shown = Number(req.body?.deposit_cents);
  if (Number.isFinite(shown) && shown !== depositCents) console.log(`[band] deposit shown ${shown} ≠ computed ${depositCents} (${spec.ref})`);
  spec.deposit = { depositCents, estimateCents, balanceCents, quoteNeeded, isEstimate: true, rate: BAND_DEPOSIT_RATE, minCents: BAND_DEPOSIT_MIN_CENTS, notes };
  const origin = `${req.protocol}://${req.get("host")}`;
  const designUrl = `${origin}/wedding-bands.html#${String(req.body?.hash || "").replace(/^#/, "").slice(0, 2000)}`;
  let order;
  try {
    const rows = await sb("band_orders", {
      method: "POST", prefer: "return=representation",
      body: {
        design_ref: spec.ref, design_url: designUrl, spec, spec_text: clean(req.body?.spec_text) || null,
        customer_name: name, email, phone,
        metal_cents: quoteNeeded ? 0 : metalCents, labor_cents: quoteNeeded ? 0 : laborCents, subtotal_cents: estimateCents || 0, shipping_cents: 0, currency: "USD", status: "pending_payment",
      },
    });
    order = rows && rows[0];
    if (!order) throw new Error("no row returned");
  } catch (e) {
    console.error("[band] could not save the request", e.message);
    return back("error");
  }
  await bandEvent(order.id, "placed", "customer", { data: { design_ref: spec.ref, pair: !!spec.pair, deposit_cents: depositCents, estimate_cents: estimateCents, quote_needed: quoteNeeded } });
  const what = spec.pair ? "wedding bands" : "wedding band";
  const params = {
    mode: "payment",
    "payment_method_types[0]": "card",
    customer_email: email,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(depositCents),
    "line_items[0][price_data][product_data][name]": `Deposit — ${what} ${spec.ref}`,
    "line_items[0][price_data][product_data][description]": `${quoteNeeded ? "Flat deposit; the price is quoted by the atelier" : `${Math.round(BAND_DEPOSIT_RATE * 100)}% of the ${money(estimateCents)} estimate`}. ${summary}`.slice(0, 500),
    "metadata[mode]": BAND_MODE,
    "metadata[band_order_id]": order.id,
    "metadata[design_ref]": spec.ref,
    "payment_intent_data[metadata][band_order_id]": order.id,
    "payment_intent_data[description]": `Azoir ${what} deposit ${order.order_number} (${spec.ref})`,
    expires_at: String(Math.floor(Date.now() / 1000) + 2 * 60 * 60),
    success_url: `${origin}/band-request/paid?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/wedding-bands.html?order=cancelled`,
  };
  try {
    const session = await stripe("checkout/sessions", params);
    await sb(`band_orders?id=eq.${order.id}`, { method: "PATCH", body: { stripe_checkout_session_id: session.id, updated_at: new Date().toISOString() } });
    res.redirect(303, session.url);
  } catch (e) {
    console.error("[band] checkout error", e);
    await sb(`band_orders?id=eq.${order.id}&status=eq.pending_payment`, { method: "PATCH", body: { status: "cancelled", updated_at: new Date().toISOString() } }).catch(() => {});
    back(e.code === "email_invalid" || e.param === "customer_email" ? "fields" : "error");
  }
}
app.post("/band-request", bandRequest);
app.post("/band-order", bandRequest);

// Stripe success redirect for a band request. The webhook delivers it regardless.
async function bandRequestPaid(req, res) {
  const id = String(req.query.session_id || "");
  if (!/^cs_\w+$/.test(id)) return res.redirect("/wedding-bands.html");
  let ref = "", number = "", deposit = "", quote = false;
  try {
    const session = await stripe(`checkout/sessions/${id}`);
    if (session.payment_status !== "paid") return res.redirect("/wedding-bands.html?order=cancelled");
    await deliverBandOrder(session);
    ref = session.metadata?.design_ref || "";
    if (Number.isFinite(session.amount_total)) deposit = String(session.amount_total);
    const rows = await sb(`band_orders?id=eq.${session.metadata?.band_order_id}&select=order_number,spec`).catch(() => null);
    if (rows && rows[0]) { number = rows[0].order_number || ""; quote = !!(rows[0].spec && rows[0].spec.deposit && rows[0].spec.deposit.quoteNeeded); }
  } catch (e) {
    console.error("[band] confirm error", e);
  }
  const q = new URLSearchParams();
  if (number) q.set("order", number);
  if (ref) q.set("ref", ref);
  if (deposit) q.set("deposit", deposit);
  if (quote) q.set("quote", "1");
  res.redirect(`/band-thanks.html${q.toString() ? `?${q}` : ""}`);
}
app.get("/band-request/paid", bandRequestPaid);
app.get("/band-order/paid", bandRequestPaid);

// Stripe webhook (checkout.session.completed) — delivers a paid request whose
// customer closed the tab before the success redirect. A 500 makes Stripe retry.
app.post("/webhooks/stripe", express.raw({ type: "application/json" }), async (req, res) => {
  const event = verifyStripeEvent(req.body, req.get("stripe-signature"), process.env.STRIPE_WEBHOOK_SECRET);
  if (!event) return res.status(400).send("invalid signature");
  try {
    const session = event.data.object;
    if (event.type === "checkout.session.completed") {
      if (session.metadata?.mode === BAND_MODE) await deliverBandOrder(session);
      else await deliverInquiry(session);
    } else if (event.type === "checkout.session.expired" && session.metadata?.mode === BAND_MODE && UUID.test(String(session.metadata.band_order_id || ""))) {
      // Never paid: the row stays pending_payment (the admin's Abandoned tab); only the timeline says why.
      const id = session.metadata.band_order_id;
      const rows = await sb(`band_orders?id=eq.${id}&status=eq.pending_payment&select=id`);
      if (rows && rows.length) await bandEvent(id, "expired", "stripe");
    }
  } catch (e) {
    console.error("[webhook] delivery error", e);
    return res.status(500).send("error");
  }
  res.json({ received: true });
});

app.use((_req, res) => res.status(404).sendFile(path.join(WEB, "404.html")));

const port = Number(process.env.PORT) || 3000;
app.listen(port, "0.0.0.0", () => console.log(`Azoir site on http://0.0.0.0:${port}`));
