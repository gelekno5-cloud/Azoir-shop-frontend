// Ready to Ship — finished pieces sold from Azoir & Co's own stock.
//
// The catalog, prices, stock, shipping rates and sales tax all live in the Moksh Diam commerce
// backend (Azoir's store there is separate from the trade shop's). This file only relays:
//   GET  /shop/api/products            the published pieces
//   GET  /shop/api/products/:handle    one piece
//   POST /shop/api/quote               shipping + tax + total for an address
//   POST /shop/api/checkout            reserves the piece and returns the Stripe Checkout URL
//   GET  /ready-to-ship/:handle        the piece page, with its title and description filled in
// Payment is recorded by the backend's own Stripe webhook; nothing here touches stock or money.
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { mokshApi } from "./commerce.js";

const HANDLE = /^[a-z0-9][a-z0-9-]{0,79}$/;
const CACHE_MS = 60_000;
const cache = new Map(); // path -> { at, status, body }

async function cached(apiPath) {
  const hit = cache.get(apiPath);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit;
  const r = await mokshApi(apiPath);
  // Only a good answer is kept; a failure is retried on the next visit.
  if (r.status === 200) cache.set(apiPath, { at: Date.now(), ...r });
  return r;
}

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
const quoteLimit = limiter(40, 15 * 60_000);
const checkoutLimit = limiter(8, 15 * 60_000);

const str = (v, max) => String(v ?? "").trim().slice(0, max);
const esc = (v) => String(v ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));

function addressFrom(b) {
  return {
    name: str(b.name, 120), line1: str(b.line1, 160), line2: str(b.line2, 160), city: str(b.city, 100),
    province: str(b.province, 60), postalCode: str(b.postalCode, 20), countryCode: str(b.countryCode, 2).toUpperCase(), phone: str(b.phone, 40),
  };
}

export function mountShop(app, { webDir }) {
  const json = express.json({ limit: "16kb" });
  const originOf = (req) => `${req.protocol}://${req.get("host")}`;

  app.get("/shop/api/products", async (_req, res) => {
    const r = await cached("/products?first=100");
    res.set("Cache-Control", "no-store").status(r.status).json(r.status === 200 ? { products: r.body.products?.nodes ?? [] } : { error: "unavailable" });
  });

  app.get("/shop/api/products/:handle", async (req, res) => {
    if (!HANDLE.test(req.params.handle)) return res.status(404).json({ error: "not_found" });
    const r = await cached(`/products/${req.params.handle}`);
    res.set("Cache-Control", "no-store").status(r.status === 200 ? 200 : r.status === 404 ? 404 : 503).json(r.status === 200 ? r.body : { error: r.status === 404 ? "not_found" : "unavailable" });
  });

  app.post("/shop/api/quote", json, async (req, res) => {
    if (quoteLimit(req.ip || "unknown")) return res.status(429).json({ error: "too_many_requests" });
    const b = req.body || {};
    const country = str(b.countryCode, 2).toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) return res.status(422).json({ error: "invalid_address" });
    const r = await mokshApi("/cart/quote", {
      method: "POST",
      body: { lines: [{ variantId: str(b.variantId, 120), quantity: 1 }], shippingAddress: { countryCode: country, province: str(b.province, 60) || undefined } },
    });
    if (r.status !== 200) return res.status(r.status === 422 ? 422 : 503).json({ error: r.body?.error || "unavailable" });
    const q = r.body;
    res.json({
      subtotal: q.subtotal, shipping: q.shipping, shippingError: q.shippingError,
      tax: q.tax, total: q.total,
    });
  });

  app.post("/shop/api/checkout", json, async (req, res) => {
    if (checkoutLimit(req.ip || "unknown")) return res.status(429).json({ error: "too_many_requests" });
    const b = req.body || {};
    const siteOrigin = originOf(req);
    if (str(b.company, 10)) return res.json({ url: `${siteOrigin}/ready-to-ship.html` }); // honeypot: bots fill every field
    const handle = HANDLE.test(str(b.handle, 80)) ? str(b.handle, 80) : "";
    const r = await mokshApi("/checkout", {
      method: "POST",
      timeoutMs: 25_000,
      body: {
        lines: [{ variantId: str(b.variantId, 120), quantity: 1, size: str(b.size, 40) || undefined }],
        email: str(b.email, 200),
        shippingAddress: addressFrom(b),
        cancelUrl: handle ? `${siteOrigin}/ready-to-ship/${handle}?cancelled=1` : `${siteOrigin}/ready-to-ship.html`,
      },
    });
    if (r.status === 200 && r.body?.url) {
      cache.clear(); // the piece is held now: the next visitor should see it as unavailable
      return res.json({ url: r.body.url });
    }
    const status = [409, 422, 429].includes(r.status) ? r.status : 503;
    res.status(status).json({ error: r.body?.error || "unavailable", message: r.body?.message });
  });

  // The piece page: one template, with the piece's own title and description for search and sharing.
  const template = () => fs.readFileSync(path.join(webDir, "ready-to-ship-piece.html"), "utf8");
  app.get("/ready-to-ship/:handle", async (req, res, next) => {
    if (!HANDLE.test(req.params.handle)) return next();
    const r = await cached(`/products/${req.params.handle}`);
    if (r.status === 404) return next();
    const siteOrigin = originOf(req);
    const p = r.status === 200 ? r.body.product : null;
    const title = p ? `${p.seo?.title || p.title} | Ready to Ship | Azoir & Co.` : "Ready to Ship | Azoir & Co.";
    const desc = p ? (p.seo?.description || p.description || `${p.title} — a finished piece from the Azoir & Co. atelier, ready to ship.`).slice(0, 300) : "Finished pieces from the Azoir & Co. atelier, ready to ship.";
    const image = p?.images?.[0]?.url || `${siteOrigin}/media/og-image.jpg`;
    const html = template()
      .replaceAll("{{TITLE}}", esc(title))
      .replaceAll("{{DESCRIPTION}}", esc(desc))
      .replaceAll("{{IMAGE}}", esc(image))
      .replaceAll("{{URL}}", esc(`${siteOrigin}/ready-to-ship/${req.params.handle}`));
    res.set("Cache-Control", "no-cache").type("html").send(html);
  });
}
