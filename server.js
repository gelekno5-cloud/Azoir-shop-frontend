// Azoir & Co. — retail site server (static pages + commission inquiry email)
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.disable("x-powered-by");
app.use(express.urlencoded({ extended: true, limit: "256kb" }));

const WEB = path.join(__dirname, "web");
const INQUIRY_TO = process.env.INQUIRY_EMAIL || "hello@azoir.co";
const INQUIRY_FROM = process.env.INQUIRY_FROM || "Azoir & Co <hello@azoir.co>";

app.get("/health", (_req, res) => res.send("ok"));

// Static assets
app.use(express.static(WEB, { extensions: ["html"], maxAge: "1h" }));
app.use("/_video", express.static(path.join(__dirname, "_video"), { maxAge: "7d" }));

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
    ["Timeline", f.timeline],
    ["Metal", f.metal],
    ["Stone", f.stone],
    ["Message", f.message],
  ].filter(([, v]) => clean(v));

  const text = rows.map(([k, v]) => `${k}: ${clean(v)}`).join("\n");
  const html =
    `<h2 style="font-family:Georgia,serif">New commission inquiry</h2>` +
    rows.map(([k, v]) => `<p><strong>${k}:</strong> ${clean(v).replace(/\n/g, "<br>")}</p>`).join("");

  try {
    if (process.env.RESEND_API_KEY) {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: INQUIRY_FROM,
          to: [INQUIRY_TO],
          reply_to: email,
          subject: `Commission inquiry — ${name}${f.type ? ` (${clean(f.type)})` : ""}`,
          text,
          html,
        }),
      });
      if (!r.ok) console.error("[inquiry] resend failed", r.status, await r.text());
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

app.use((_req, res) => res.status(404).sendFile(path.join(WEB, "index.html")));

const port = Number(process.env.PORT) || 3000;
app.listen(port, "0.0.0.0", () => console.log(`Azoir site on http://0.0.0.0:${port}`));
