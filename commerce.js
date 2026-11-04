// azoir.co ↔ the Moksh Diam commerce backend (mokshdiam.com).
//
//  • Band pricing: a band design's estimate goes through the backend's cart quote (customLines), so
//    the admin's discount codes, shipping zones and tax settings apply at the Request step.
//  • Discount codes are counted with redeem_discount() in the shared Supabase when a request is
//    saved, and given back with release_discount() when its checkout fails or expires.
//  • My account: /account/api/* forwards to the backend's customer API. The customer access token
//    lives in an httpOnly cookie on azoir.co, never in page script.
import express from "express";

export const MOKSH_URL = (process.env.MOKSH_API_URL || process.env.ADMIN_URL || "https://mokshdiam.com").replace(/\/+$/, "");
const API = `${MOKSH_URL}/api/storefront/v1`;
const COOKIE = "azoir_customer";
const TOKEN_RE = /^[A-Za-z0-9_-]{20,100}$/;

/** JSON call to the backend's storefront API. Resolves { status, body }; never throws on HTTP errors. */
export async function mokshApi(path, { method = "GET", body, token, timeoutMs = 8000 } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(`${API}${path}`, {
      method,
      signal: ctl.signal,
      headers: { Accept: "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { error: "bad_response" }; }
    return { status: r.status, body: json };
  } catch (e) {
    return { status: 503, body: { error: "unavailable", detail: e.name === "AbortError" ? "timeout" : e.message } };
  } finally {
    clearTimeout(timer);
  }
}

const cents = (m) => (m && typeof m.amount === "string" ? Math.round(Number(m.amount) * 100) : 0);
export const normaliseCode = (v) => String(v || "").trim().toUpperCase().replace(/\s+/g, "").slice(0, 40);
export const normaliseCountry = (v) => (/^[A-Za-z]{2}$/.test(String(v || "").trim()) ? String(v).trim().toUpperCase() : null);

/**
 * Price a priced band design with the backend: discount, shipping, tax. Returns
 * { ok: true, listCents, discount|null, discountError|null, shipping|null, taxCents, taxMode, taxIncluded, totalCents }
 * or { ok: false } when the backend can't be reached (callers fall back to the plain estimate).
 */
export async function quoteBand({ estimateCents, title, code, country, region, email }) {
  const r = await mokshApi("/cart/quote", {
    method: "POST",
    body: {
      customLines: [{ title: String(title || "Wedding band").slice(0, 120), priceCents: estimateCents, quantity: 1 }],
      discountCode: code || undefined,
      shippingAddress: country ? { countryCode: country, province: region || undefined } : undefined,
      email: email || undefined,
    },
  });
  if (r.status !== 200 || !r.body || !r.body.total) return { ok: false };
  const b = r.body;
  return {
    ok: true,
    listCents: cents(b.subtotal),
    discount: b.discount ? { code: b.discount.code, title: b.discount.title, cents: cents(b.discount.amount), freeShipping: !!b.discount.freeShipping } : null,
    discountError: b.discountError ? { code: b.discountError.code, message: b.discountError.message } : null,
    shipping: b.shipping ? { id: b.shipping.id, name: b.shipping.title, cents: cents(b.shipping.price) } : null,
    shippingError: b.shippingError || null,
    taxCents: cents(b.tax && b.tax.amount),
    taxMode: (b.tax && b.tax.mode) || "none",
    taxIncluded: !!(b.tax && b.tax.includedInPrices),
    taxTitle: (b.tax && b.tax.title) || null,
    totalCents: cents(b.total),
  };
}

/** Count a code for a saved request. Resolves the backend's result string ("redeemed", "existing", "used_up", …). */
export async function redeemDiscount(sb, { code, orderId, email, subtotalCents, amountCents }) {
  const r = await sb("rpc/redeem_discount", {
    method: "POST",
    body: { p_code: code, p_channel: "azoir_retail", p_order_ref: `band:${orderId}`, p_email: email || null, p_subtotal_cents: subtotalCents, p_amount_cents: amountCents },
  });
  return (r && r.result) || "error";
}

/** Give a request's code use back (its checkout failed or expired). Never throws. */
export async function releaseDiscount(sb, orderId) {
  try { await sb("rpc/release_discount", { method: "POST", body: { p_order_ref: `band:${orderId}` } }); }
  catch (e) { console.error("[commerce] release_discount failed", e.message); }
}

// ── My account: /account/api/* → the backend's customer API ──────────────────

function readCookie(req, name) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
const tokenOf = (req) => { const t = readCookie(req, COOKIE); return t && TOKEN_RE.test(t) ? t : null; };

function setTokenCookie(req, res, token, expiresAt) {
  const secure = req.secure || req.headers["x-forwarded-proto"] === "https";
  const maxAge = Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000)) || 30 * 86400;
  res.setHeader("Set-Cookie", `${COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`);
}
function clearTokenCookie(res) {
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
}

/** Per-shopper (per-IP) sliding window, so the backend's looser per-IP limit isn't the only gate. */
function limiter(perWindow, windowMs) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const seen = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (seen.length >= perWindow) { hits.set(key, seen); return true; }
    seen.push(now); hits.set(key, seen);
    if (hits.size > 5000) for (const [k, v] of hits) if (v.every((t) => now - t > windowMs)) hits.delete(k);
    return false;
  };
}
const codeLimit = limiter(6, 15 * 60_000);
const signInLimit = limiter(12, 15 * 60_000);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Mount /account/api/* on the app. */
export function mountAccountApi(app) {
  const r = express.Router();
  r.use(express.json({ limit: "16kb" }));
  // Same-origin only: a cross-site form can't post JSON, and these never answer to other origins.
  r.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "GET" && req.method !== "DELETE" && !String(req.headers["content-type"] || "").startsWith("application/json")) return res.status(415).json({ error: "json_only" });
    // DELETE carries no body, so a cross-site form can't send one; still require a same-origin fetch.
    if (req.method === "DELETE" && req.headers["sec-fetch-site"] && req.headers["sec-fetch-site"] !== "same-origin") return res.status(403).json({ error: "forbidden" });
    next();
  });
  const relay = (res, out, map = (b) => b) => res.status(out.status).json(out.status < 400 ? map(out.body) : out.body);
  const authed = (handler) => async (req, res) => {
    const token = tokenOf(req);
    if (!token) return res.status(401).json({ error: "unauthorized" });
    const out = await handler(req, token);
    if (out.status === 401) clearTokenCookie(res);
    relay(res, out);
  };

  r.post("/login-code", async (req, res) => {
    if (codeLimit(req.ip || "unknown")) return res.status(429).json({ error: "too_many_requests" });
    relay(res, await mokshApi("/customer/login-code", { method: "POST", body: { email: String(req.body?.email || "").slice(0, 254) } }));
  });

  r.post("/sign-in", async (req, res) => {
    if (signInLimit(req.ip || "unknown")) return res.status(429).json({ error: "too_many_requests" });
    const out = await mokshApi("/customer/access-token", { method: "POST", body: { email: String(req.body?.email || "").slice(0, 254), code: String(req.body?.code || "").slice(0, 12) } });
    if (out.status < 300 && out.body && TOKEN_RE.test(String(out.body.customerAccessToken || ""))) {
      setTokenCookie(req, res, out.body.customerAccessToken, out.body.expiresAt);
      return res.status(out.status).json({ signedIn: true, created: !!out.body.created });
    }
    relay(res, out);
  });

  r.post("/sign-out", async (req, res) => {
    const token = tokenOf(req);
    if (token) await mokshApi("/customer/access-token", { method: "DELETE", token });
    clearTokenCookie(res);
    res.json({ signedOut: true });
  });

  r.get("/me", authed((_req, token) => mokshApi("/customer", { token })));
  r.patch("/me", authed((req, token) => mokshApi("/customer", { method: "PATCH", token, body: req.body || {} })));
  r.get("/orders", authed((_req, token) => mokshApi("/customer/orders", { token })));
  r.get("/wishlist", authed((_req, token) => mokshApi("/customer/wishlist", { token })));
  r.post("/addresses", authed((req, token) => mokshApi("/customer/addresses", { method: "POST", token, body: req.body || {} })));
  r.patch("/addresses/:id", authed((req, token) => UUID.test(req.params.id)
    ? mokshApi(`/customer/addresses/${req.params.id}`, { method: "PATCH", token, body: req.body || {} })
    : Promise.resolve({ status: 404, body: { error: "not_found" } })));
  r.delete("/addresses/:id", authed((req, token) => UUID.test(req.params.id)
    ? mokshApi(`/customer/addresses/${req.params.id}`, { method: "DELETE", token })
    : Promise.resolve({ status: 404, body: { error: "not_found" } })));

  app.use("/account/api", r);
}
