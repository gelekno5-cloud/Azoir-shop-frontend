// Azoir & Co. — retail site server (static pages + commission inquiry email)
import express from "express";
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

app.get("/health", (_req, res) => res.send("ok"));

// Static assets (media incl. hero.mp4 lives under web/media)
app.use(express.static(WEB, { extensions: ["html"], maxAge: "1h" }));

// Commission inquiry — email the brief to the atelier
app.post("/inquiry", async (req, res) => {
  const f = req.body || {};
  const clean = (s) => String(s || "").slice(0, 4000).trim();
  const name = clean(f.name);
  const email = clean(f.email);

  if (!name || !email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.redirect("/commission.html?error=1");
  }

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
  ].filter(([, v]) => clean(v));

  const text = rows.map(([k, v]) => `${k}: ${clean(v)}`).join("\n");
  const html =
    `<h2 style="font-family:Georgia,serif">New commission inquiry</h2>` +
    rows.map(([k, v]) => `<p><strong>${k}:</strong> ${clean(v).replace(/\n/g, "<br>")}</p>`).join("");

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
    `We've received your commission inquiry and it's with our atelier. A designer will personally reply within one business day to begin the conversation — no obligation, just possibilities.\n\n` +
    `In the meantime, feel free to gather any inspiration — a stone you love, a piece you've seen, a photo of something meaningful. You'll be able to share it with us once we're in touch.\n\n` +
    `With care,\nAzoir & Co. · New York\nhello@azoir.co`;
  const p = 'font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.7;color:#475569';
  const arHtml =
    `<div style="max-width:520px;margin:0 auto">` +
    `<p style="font-family:Georgia,serif;font-size:20px;color:#18181B">Thank you, ${firstName}.</p>` +
    `<p style="${p}">We've received your commission inquiry and it's with our atelier. A designer will personally reply within one business day to begin the conversation — no obligation, just possibilities.</p>` +
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

  res.redirect("/thanks.html");
});

app.use((_req, res) => res.status(404).sendFile(path.join(WEB, "404.html")));

const port = Number(process.env.PORT) || 3000;
app.listen(port, "0.0.0.0", () => console.log(`Azoir site on http://0.0.0.0:${port}`));
