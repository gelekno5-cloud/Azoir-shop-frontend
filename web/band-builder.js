/* Azoir & Co. — wedding band builder.
   Procedural 3D band (three.js): a cross-section profile is swept around the
   ring axis, so every option (profile, width, depth, edges, size, colour zones,
   stone setting) is real geometry and the weight estimate comes from the
   rendered volume — per metal zone. One band, or a His & Hers pair. */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// ── Catalogue ────────────────────────────────────────────────────────────────
const PROFILES = {
  court:   { name: "Court",       desc: "Softly domed, the classic comfort band" },
  flat:    { name: "Flat",        desc: "Clean, modern, square edges" },
  dshape:  { name: "D-shape",     desc: "Half-round, traditional" },
  knife:   { name: "Knife edge",  desc: "A crisp ridge down the centre" },
  bevel:   { name: "Bevelled",    desc: "Flat top, chamfered edges" },
  concave: { name: "Concave",     desc: "Scooped centre, raised edges" },
  round:   { name: "Full round",  desc: "Fully rounded, like a polished wire" },
  custom:  { name: "Custom",      desc: "Imported cross-section" },
};
const INTERIORS = { comfort: "Comfort fit", flat: "Flat" };
// Base colour = sRGB of the metal's reflectance; density in g/cm³.
// `color` is the alloy as the Moksh Diam viewer renders it: the median of
// MatrixGold's rendered swatches (moksh-azoir metalConfigs.generated.ts). The
// same values drive the portal viewer and the try-on, so every model matches.
const METALS = {
  "14y": { name: "14k Yellow Gold", wizard: "Yellow gold", color: "#d19f37", density: 13.1, sw: "#d19f37" },
  "14w": { name: "14k White Gold",  wizard: "White gold",  color: "#cbcbcb", density: 12.7, sw: "#cbcbcb" },
  "14r": { name: "14k Rose Gold",   wizard: "Rose gold",   color: "#dc987b", density: 13.0, sw: "#dc987b" },
  "18y": { name: "18k Yellow Gold", wizard: "Yellow gold", color: "#d19f37", density: 15.5, sw: "#d19f37" },
  "18w": { name: "18k White Gold",  wizard: "White gold",  color: "#cbcbcb", density: 15.1, sw: "#cbcbcb" },
  "18r": { name: "18k Rose Gold",   wizard: "Rose gold",   color: "#dc987b", density: 15.2, sw: "#dc987b" },
  "pt":  { name: "Platinum 950",    wizard: "Platinum",    color: "#cfcece", density: 20.6, sw: "#cfcece" },
};
// ── Price estimate (owner's rule, 2026-10-17) ────────────────────────────────
// Estimate = metal weight × the alloy's rate + flat labour per band. 14k is
// $120/g; 18k scales by fine-gold content. A metal with no rate (platinum until
// the atelier sets one) makes the band "quoted individually". Diamonds are
// never estimated here. Always shown as an estimate, never a quote; editable
// in band-catalog.json under "pricing".
let PRICING = {
  laborCents: 10000,
  perGramCents: { "14y": 12000, "14w": 12000, "14r": 12000, "18y": 15400, "18w": 15400, "18r": 15400, pt: null },
};
const usd = (cents) => "$" + Math.round(cents / 100).toLocaleString("en-US");
function estimateBand(b, m) {
  let metalCents = 0; const unpriced = [];
  for (let z = 0; z < b.zones; z++) {
    const rate = PRICING.perGramCents[b.metals[z]];
    if (rate == null) { if (!unpriced.includes(METALS[b.metals[z]].name)) unpriced.push(METALS[b.metals[z]].name); continue; }
    metalCents += m.zoneGrams[z] * rate;
  }
  metalCents = Math.round(metalCents);
  return { metalCents, laborCents: PRICING.laborCents, totalCents: unpriced.length ? null : metalCents + PRICING.laborCents, unpriced, stones: m.stones > 0 };
}
function estimateAll() {
  const list = ui.pair ? [0, 1] : [0];
  const parts = list.map((i) => estimateBand(bands[i], views[i].metrics));
  const unpriced = [...new Set(parts.flatMap((e) => e.unpriced))];
  return { parts, unpriced, metalCents: parts.reduce((a, e) => a + e.metalCents, 0), laborCents: parts.reduce((a, e) => a + e.laborCents, 0),
    totalCents: unpriced.length ? null : parts.reduce((a, e) => a + e.totalCents, 0), stones: parts.some((e) => e.stones) };
}
function estimateText(e, short = false) {
  if (e.totalCents == null) return short ? "Quoted individually" : `Quoted individually — ${e.unpriced.join(", ")} has no set rate yet`;
  return `≈ ${usd(e.totalCents)}` + (e.stones ? (short ? " + diamonds" : " + diamonds, quoted separately") : "") + (short ? "" : " — estimate only");
}

// Each finish is a real surface: a generated normal map at true scale (tile = mm).
const FINISHES = {
  polished: { name: "Polished",  roughness: 0.04, micro: 0.03 },
  satin:    { name: "Satin",     roughness: 0.2, anisotropy: 0.45, micro: 0.05, map: "satin", tile: 2.5, scale: 0.8 },
  hammered: { name: "Hammered",  roughness: 0.06, micro: 0.03, map: "hammered", tile: 7, scale: 1.0 },
  matte:    { name: "Matte",     roughness: 0.55, micro: 0.08, map: "matte", tile: 1.2, scale: 0.45 },
  brushed:  { name: "Brushed",   roughness: 0.26, anisotropy: 0.8, anisoRot: 0, micro: 0.05, map: "brushed", tile: 2.5, scale: 0.8 },
  sandblast:{ name: "Sandblast", roughness: 0.42, micro: 0.06, map: "sandblast", tile: 0.8, scale: 0.9 },
  ice:      { name: "Ice",       roughness: 0.22, map: "ice", tile: 2.2, scale: 1.0 },
  bark:     { name: "Bark",      roughness: 0.38, map: "bark", tile: 5, scale: 1.1 },
};
// `stones` keeps its original values (none / half / full) and gains two spans.
const SPANS = { none: "None", full: "Full eternity", half: "Half eternity", third: "⅓ eternity", quarter: "¼ eternity" };
const SPAN_ANGLE = { full: Math.PI * 2, half: Math.PI, third: Math.PI * 2 / 3, quarter: Math.PI / 2 };
const STONE_SIZES = { s: { name: "Petite", k: 0.75 }, m: { name: "Classic", k: 1 }, l: { name: "Bold", k: 1.3 } };
const EDGES = { rounded: "Rounded", bevel: "Bevelled", sharp: "Sharp", milgrain: "Milgrain" };
const FONTS = {
  script: 'italic 500 104px "Cormorant Garamond", Georgia, serif',
  serif:  '500 96px "Cormorant Garamond", Georgia, serif',
  sans:   '400 78px "DM Sans", system-ui, sans-serif',
};
const ZONE_NAMES = { 1: ["Metal"], 2: ["Left", "Right"], 3: ["Left", "Centre", "Right"] };
const SIZE_SYS = { us: "US", eu: "EU", uk: "UK" };
const BAND_NAMES = ["Hers", "His"];
// What a linked pair shares. Width, depth, size, diamonds and engraving stay per band.
const LINKED = ["profile", "interior", "zones", "zsplit", "zmid", "metals", "finishes", "edgel", "edger", "wave", "wavef", "wavemode"];

// ── Ring sizes (US chart = web/ring-size.html; EU = ISO circumference; UK letters) ──
let SIZE_A = 11.66, SIZE_B = 0.811; // US size → inside diameter (mm), same chart as ring-size.html
const usToDiameter = (us) => SIZE_A + SIZE_B * us;
const usToEU = (us) => Math.PI * usToDiameter(us);
const euToUS = (eu) => (eu / Math.PI - SIZE_A) / SIZE_B;
const UK = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const ukToUS = (idx, half) => 3.75 + (idx - 7) * 0.5 + (half ? 0.25 : 0); // UK H = US 3¾, each letter = ½ US size
function usToUK(us) {
  const steps = Math.round((us - 3.75) * 4), idx = 7 + Math.floor(steps / 2), half = steps % 2 === 1;
  if (idx < 0) return "—";
  if (idx > 25) return "Z+" + (idx - 25) + (half ? "½" : "");
  return UK[idx] + (half ? "½" : "");
}
const clampSize = (v) => Math.min(13, Math.max(3.75, Math.round(v * 4) / 4));
function usLabel(us) { const w = Math.floor(us), f = Math.round((us - w) * 4); return String(w) + ["", "¼", "½", "¾"][f]; }
function sizeOptions(sys) {
  const o = [];
  if (sys === "eu") { for (let eu = 47; eu <= 70; eu++) o.push({ v: clampSize(euToUS(eu)), label: "EU " + eu }); }
  else if (sys === "uk") { for (let i = 7; i <= 25; i++) { o.push({ v: ukToUS(i, false), label: "UK " + UK[i] }); o.push({ v: ukToUS(i, true), label: "UK " + UK[i] + "½" }); } }
  else { for (let s = 4; s <= 13; s += 0.5) o.push({ v: s, label: "US " + usLabel(s) }); }
  return o;
}
const sizeText = (us) => `US ${usLabel(us)} · EU ${Math.round(usToEU(us))} · UK ${usToUK(us)}`;

// ── State ────────────────────────────────────────────────────────────────────
let DEFAULTS = {}; // overridden by band-catalog.json
const WAVE_MODES = { groove: "Groove", split: "Split line", both: "Both" };
const defaultBand = (i) => ({
  profile: "court", interior: "comfort", width: i ? 6 : 4, depth: i ? 2 : 1.8,
  metals: ["18y", "18y", "18y"], finishes: ["polished", "polished", "polished"], zones: 1, zsplit: 0.5, zmid: 0.34,
  edgel: "rounded", edger: "rounded",
  wave: 0, wavef: 8, wavemode: "groove",
  stones: "none", shape: "round", setting: "channel", stonesz: "m",
  size: i ? 10 : 7, engraving: "", font: "script",
  ...(DEFAULTS[i ? "his" : "band"] || {}),
});
const bands = [defaultBand(0), defaultBand(1)];
const ui = { pair: false, link: true, active: 0, zone: 0, sizesys: "us", tab: "shape" };
const active = () => bands[ui.active];

// ── State from a shared link (band A keys are unprefixed, as in v1; band B = b_*) ──
function readBand(q, p, b) {
  const g = (k) => q.get(p + k);
  const pick = (k, table, set) => { const v = g(k); if (v != null && table[v]) set(v); };
  pick("profile", PROFILES, (v) => (b.profile = v)); pick("interior", INTERIORS, (v) => (b.interior = v));
  pick("metal", METALS, (v) => (b.metals[0] = v)); pick("metal2", METALS, (v) => (b.metals[1] = v)); pick("metal3", METALS, (v) => (b.metals[2] = v));
  pick("finish", FINISHES, (v) => (b.finishes[0] = v)); pick("finish2", FINISHES, (v) => (b.finishes[1] = v)); pick("finish3", FINISHES, (v) => (b.finishes[2] = v));
  pick("stones", SPANS, (v) => (b.stones = v));
  { const v = g("shape"); if (v && SHAPES[LEGACY_SHAPE[v] || v]) b.shape = LEGACY_SHAPE[v] || v; }
  { const v = g("setting"); if (v && SETTINGS[LEGACY_SETTING[v] || v]) b.setting = LEGACY_SETTING[v] || v; } pick("stonesz", STONE_SIZES, (v) => (b.stonesz = v));
  pick("edgel", EDGES, (v) => (b.edgel = v)); pick("edger", EDGES, (v) => (b.edger = v)); pick("font", FONTS, (v) => (b.font = v));
  pick("wavemode", WAVE_MODES, (v) => (b.wavemode = v));
  if (b.profile === "custom" && !CUSTOM) b.profile = "court"; // the imported section lives in this browser only
  const num = (k, lo, hi, set) => { const v = parseFloat(g(k)); if (Number.isFinite(v)) set(Math.min(hi, Math.max(lo, v))); };
  num("width", 2, 8, (v) => (b.width = v)); num("depth", 1.2, 2.6, (v) => (b.depth = v));
  num("size", 3.75, 13, (v) => (b.size = Math.round(v * 4) / 4)); num("zones", 1, 3, (v) => (b.zones = Math.round(v)));
  num("zsplit", 0.2, 0.8, (v) => (b.zsplit = v)); num("zmid", 0.2, 0.7, (v) => (b.zmid = v));
  num("wave", 0, 0.4, (v) => (b.wave = v)); num("wavef", 1, 20, (v) => (b.wavef = Math.round(v)));
  const e = g("engraving"); if (e != null) b.engraving = e.slice(0, 30);
}
function readHash() {
  const q = new URLSearchParams(location.hash.slice(1));
  readBand(q, "", bands[0]);
  ui.pair = q.get("pair") === "1";
  if (ui.pair) { ui.link = q.get("link") !== "0"; readBand(q, "b_", bands[1]); }
  const ss = q.get("sizesys"); if (ss && SIZE_SYS[ss]) ui.sizesys = ss;
  ui.tryonStart = q.get("tryon") === "1"; // a QR-scanned link opens straight into try-on
}
function writeBand(q, p, b) {
  q.set(p + "profile", b.profile); q.set(p + "interior", b.interior); q.set(p + "width", b.width); q.set(p + "depth", b.depth);
  q.set(p + "metal", b.metals[0]); q.set(p + "finish", b.finishes[0]);
  if (b.zones > 1) { q.set(p + "zones", b.zones); q.set(p + "metal2", b.metals[1]); q.set(p + "finish2", b.finishes[1]); }
  if (b.zones === 2 && b.zsplit !== 0.5) q.set(p + "zsplit", b.zsplit);
  if (b.zones > 2) { q.set(p + "metal3", b.metals[2]); q.set(p + "finish3", b.finishes[2]); if (b.zmid !== 0.34) q.set(p + "zmid", b.zmid); }
  q.set(p + "stones", b.stones);
  if (b.stones !== "none") { q.set(p + "shape", b.shape); q.set(p + "setting", b.setting); q.set(p + "stonesz", b.stonesz); }
  if (b.wave > 0) { q.set(p + "wave", b.wave); q.set(p + "wavef", b.wavef); q.set(p + "wavemode", b.wavemode); }
  if (b.edgel !== "rounded") q.set(p + "edgel", b.edgel);
  if (b.edger !== "rounded") q.set(p + "edger", b.edger);
  q.set(p + "size", b.size); q.set(p + "font", b.font);
  if (b.engraving) q.set(p + "engraving", b.engraving);
}
function writeHash() {
  const q = new URLSearchParams();
  writeBand(q, "", bands[0]);
  if (ui.pair) { q.set("pair", "1"); q.set("link", ui.link ? "1" : "0"); writeBand(q, "b_", bands[1]); }
  if (ui.sizesys !== "us") q.set("sizesys", ui.sizesys);
  history.replaceState(null, "", "#" + q.toString());
}

// ── Cross-section ────────────────────────────────────────────────────────────
// Points are {x: radius, y: along the ring axis}, in mm. The loop runs: outer
// surface (y rising) → side → inner surface (y falling) → side. A channel for
// stones is notched into the outer surface. Each "run" is shaded smoothly on
// its own, so channel walls, chamfers and sharp edges stay crisp. Colour zones
// split the section by y: a two-tone band really is two rings joined side by
// side, so the per-zone volume is the real metal of each.
function outerRadius(b, ri, y) {
  const w = b.width, t = b.depth, u = Math.abs(2 * y / w);
  switch (b.profile) {
    case "flat":    return ri + t;
    case "court":   return ri + t - 0.28 * t * u * u;
    case "dshape":  return ri + 0.3 * t + 0.7 * t * Math.sqrt(Math.max(0, 1 - u * u));
    case "knife":   return ri + t - 0.5 * t * u;
    case "bevel":   return u <= 0.55 ? ri + t : ri + t - 0.32 * t * ((u - 0.55) / 0.45);
    case "concave": return ri + 0.68 * t + 0.32 * t * u * u;
    case "round":   return ri + t / 2 + 0.02 * t + 0.48 * t * Math.sqrt(Math.max(0, 1 - u * u));
  }
  return ri + t;
}
function innerRadius(b, ri, y) {
  const u = 2 * y / b.width;
  if (b.profile === "round") return ri + 0.5 * b.depth * (1 - 0.96 * Math.sqrt(Math.max(0, 1 - u * u)));
  if (b.interior !== "comfort") return ri;
  return ri + Math.min(0.32 * b.depth, 0.45) * u * u;
}
function zoneBoundsOf(b) {
  const w = b.width, hw = w / 2;
  if (b.zones === 2) return [-hw + w * b.zsplit];
  if (b.zones === 3) return [-hw + w * (1 - b.zmid) / 2, hw - w * (1 - b.zmid) / 2];
  return [];
}
function minZoneWidth(b) {
  const ys = [-b.width / 2, ...zoneBoundsOf(b), b.width / 2];
  let m = Infinity; for (let i = 1; i < ys.length; i++) m = Math.min(m, ys[i] - ys[i - 1]);
  return m;
}
function edgeTreatment(b, side) {
  const edge = side < 0 ? b.edgel : b.edger;
  const mode = b.profile === "round" ? "sharp" : edge === "milgrain" ? "rounded" : edge;
  if (mode === "sharp") return { mode, d: 0 };
  const base = edge === "milgrain" ? Math.min(0.28 * b.depth, 0.32) : mode === "rounded" ? Math.min(0.4 * b.depth, 0.55) : Math.min(0.38 * b.depth, 0.6);
  return { mode, d: Math.min(base, 0.45 * minZoneWidth(b), 0.3 * b.width) };
}
// Cut `d` of arc length off one end of a polyline, inserting a point exactly
// there, so a fillet / chamfer of that size has a clean neighbour to land on.
function trimEnd(pts, d, atStart) {
  if (d <= 0 || pts.length < 2) return pts;
  const p = atStart ? pts : [...pts].reverse();
  let acc = 0, k = 1;
  for (; k < p.length; k++) { const l = Math.hypot(p[k].x - p[k - 1].x, p[k].y - p[k - 1].y); if (acc + l >= d) break; acc += l; }
  if (k >= p.length) return pts;
  const a = p[k - 1], q = p[k], l = Math.hypot(q.x - a.x, q.y - a.y), u = (d - acc) / l;
  const out = [{ ...p[0] }, { x: a.x + (q.x - a.x) * u, y: a.y + (q.y - a.y) * u }, ...p.slice(k)];
  return atStart ? out : out.reverse();
}
// Corner treatment of a polyline: untagged corners get a small fillet, tagged
// edge corners get their rounded / bevelled / sharp treatment. Points marked
// `split` start a new run (crisp shading on both sides).
function shapeCorners(pts, fillet, closed) {
  const n = pts.length, out = [];
  if (!closed) out.push({ x: pts[0].x, y: pts[0].y });
  for (let i = closed ? 0 : 1; i < (closed ? n : n - 1); i++) {
    const a = pts[(i - 1 + n) % n], p = pts[i], b = pts[(i + 1) % n];
    const ax = a.x - p.x, ay = a.y - p.y, bx = b.x - p.x, by = b.y - p.y;
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    const mode = p.edge || "fillet";
    if (mode === "sharp") { out.push({ x: p.x, y: p.y, split: true }); continue; }
    if (la < 1e-9 || lb < 1e-9) { out.push({ x: p.x, y: p.y }); continue; }
    const cosT = (ax * bx + ay * by) / (la * lb);
    if (cosT < -0.985) { out.push({ x: p.x, y: p.y }); continue; } // ~straight
    const d = mode === "fillet" ? Math.min(fillet, la * 0.45, lb * 0.45) : Math.min(p.r || 0, la * 0.98, lb * 0.98);
    if (d < 1e-4) { out.push({ x: p.x, y: p.y, split: mode !== "fillet" }); continue; }
    const t1 = { x: p.x + ax / la * d, y: p.y + ay / la * d };
    const t2 = { x: p.x + bx / lb * d, y: p.y + by / lb * d };
    if (mode === "bevel") { out.push({ ...t1, split: true }, { ...t2, split: true }); continue; }
    for (let k = 0; k <= 6; k++) {
      const u = k / 6, v = 1 - u;
      out.push({ x: v * v * t1.x + 2 * u * v * p.x + u * u * t2.x, y: v * v * t1.y + 2 * u * v * p.y + u * u * t2.y });
    }
  }
  out.push(closed ? { x: out[0].x, y: out[0].y } : { x: pts[n - 1].x, y: pts[n - 1].y });
  return out;
}
function splitRuns(poly) {
  const runs = []; let cur = [poly[0]];
  for (let i = 1; i < poly.length; i++) {
    cur.push(poly[i]);
    if (poly[i].split && i < poly.length - 1) { runs.push(cur); cur = [poly[i]]; }
  }
  runs.push(cur);
  return runs;
}
// ── Stones & settings: manufacturing rules ───────────────────────────────────
// Dimensions in mm. `s` is the stone's short side (the size the customer
// picks), W its extent across the band, Lx along it. Every rule below is what
// a setter needs to actually hold the stone, and the UI only offers what passes.
const SHAPES = {
  round:    { name: "Round brilliant", ratio: 1,    depth: 0.60, crown: 0.16, fit: 1,    k: 0.0061 },
  princess: { name: "Princess",        ratio: 1,    depth: 0.70, crown: 0.12, fit: 1,    k: 0.0083 },
  emerald:  { name: "Emerald",         ratio: 1.4,  depth: 0.65, crown: 0.15, fit: 0.72, k: 0.0092 },
  baguette: { name: "Baguette",        ratio: 2,    depth: 0.60, crown: 0.12, fit: 0.55, k: 0.0092 },
};
// The five ways stones are actually set into a band. Each is real metal built
// on the band (see BandView.build) and each carries the setter's rules.
const SETTINGS = {
  channel: { name: "Channel",      shapes: ["round", "princess", "baguette", "emerald"], wall: 0.45, gap: 0.15 },
  pave:    { name: "Pavé",         shapes: ["round"], side: 0.6, gap: 0.15, min: 1.0, max: 2.5, bead: 0.13 },
  shared:  { name: "Shared prong", shapes: ["round"], prong: 0.55, side: 0.9, raised: true, scoop: true },
  flush:   { name: "Flush",        shapes: ["round", "princess"], rim: 0.35, gap: 0.5, flush: true },
  bar:     { name: "Bar",          shapes: ["baguette", "emerald", "princess"], wall: 0.45, bar: 0.5, gap: 0.1 },
};
// Older share links used these names.
const LEGACY_SETTING = { bezel: "flush", prong: "shared", split: "shared", uprong: "shared", fishtail: "pave" };
const LEGACY_SHAPE = { cushion: "round" };
const r1 = (v) => Math.round(v * 10) / 10;
const stoneBase = (width, stonesz) => { const base = Math.min(Math.max(r1((width - 1.4) * 0.6), 1.2), 2.4); return Math.max(1.0, Math.min(3.2, r1(base * STONE_SIZES[stonesz].k))); };
function stoneDims(shape, d) {
  const sh = SHAPES[shape], s = r1(d * sh.fit), long = r1(s * sh.ratio);
  return { s, W: sh.along ? s : long, Lx: sh.along ? long : s, D: sh.depth * s, hc: sh.crown * s };
}
const zoneAtY = (b, y) => { let z = 0; for (const yb of zoneBoundsOf(b)) if (y > yb) z++; return z; };
const dimsText = (shape, dm) => shape === "round" || shape === "princess" ? `${fmt(dm.s)} mm` : `${fmt(dm.Lx)} × ${fmt(dm.W)} mm`;
// The rules. Returns {issue} (a one-line reason, or null) plus the numbers behind it.
function stoneRules(b, shape = b.shape, setting = b.setting, stonesz = b.stonesz) {
  const st = SETTINGS[setting], sh = SHAPES[shape];
  const d = stoneBase(b.width, stonesz), dm = stoneDims(shape, d);
  const minWidth = st.wall != null ? dm.W + 2 * (st.wall + 0.05) : st.rim ? dm.W + 2 * st.rim + 0.1 : dm.W + st.side;
  const hp = dm.D - dm.hc;
  const seat = st.raised ? hp + 0.27 : dm.D + 0.37; // pavilion + 0.3 mm floor (+ crown when the table sits flush)
  let issue = null;
  if (b.profile === "custom") issue = "imported cross-sections can't take stones yet";
  else if (!st.shapes.includes(shape)) issue = `${st.name}: ${st.shapes.map((k) => SHAPES[k].name.toLowerCase()).join(", ")} only`;
  else if (b.width + 1e-6 < minWidth) issue = `${sh.name} ${dimsText(shape, dm)} in ${st.name.toLowerCase()} needs a band ≥ ${fmt(Math.ceil(minWidth * 10) / 10)} mm wide`;
  else if (seat > b.depth + 1e-6) issue = `${sh.name} ${dimsText(shape, dm)} needs a deeper band (seat ${fmt(seat)} mm, band ${fmt(b.depth)} mm)`;
  else if (st.min && (dm.s < st.min || dm.s > st.max)) issue = `${st.name} suits ${st.min}–${st.max} mm stones`;
  return { issue, minWidth, seat, d, hp, ...dm };
}
// If the band changed under a stone choice, step the size down; failing that, drop the stones. Never render an unsettable band.
function coerceStones(b) {
  b.stoneNote = "";
  if (b.stones === "none") return;
  const bad = stoneRules(b).issue;
  if (!bad) return;
  for (const k of ["m", "s"]) if (STONE_SIZES[k].k < STONE_SIZES[b.stonesz].k && !stoneRules(b, b.shape, b.setting, k).issue) {
    b.stoneNote = `Stone size reduced to ${STONE_SIZES[k].name.toLowerCase()}: ${bad}`; b.stonesz = k; return;
  }
  b.stoneNote = `Diamonds removed: ${bad}`; b.stones = "none";
}
function stoneSpec(b) {
  if (b.stones === "none") return null;
  const r = stoneRules(b);
  if (r.issue) return null;
  const st = SETTINGS[b.setting];
  const prong = st.prong ? (b.metals[zoneAtY(b, 0)] === "pt" ? Math.max(st.prong, 0.6) : st.prong) : 0;
  const rp = prong / 2;
  const girdleBelow = st.raised ? -0.05 : r.hc + 0.05; // girdle just over the surface (prongs) or table flush with it
  const channel = !st.flush;                            // flush stones are sunk one by one; everything else sits in a groove
  const channelD = channel ? girdleBelow + r.hp + 0.02 : 0; // groove floor just under the pavilion tip; 0.3 mm of metal stays beneath
  const channelW = !channel ? 0 : st.scoop ? r.W + 0.5 : st.raised ? r.W + 0.2 : r.W + 0.1;
  let pitch, zp = 0, endPad = 0.2;
  if (st.prong) {
    // a shared prong touches both neighbours: sit it at ±zp across the band and space the stones so the geometry closes
    zp = Math.min(0.3 * r.W, b.width / 2 - rp - 0.1);
    const reach = r.Lx / 2 + rp;
    pitch = 2 * Math.sqrt(Math.max(0.05, reach * reach - zp * zp));
    endPad = 0.3 + rp;
  } else if (st.bar) { pitch = r.Lx + st.bar + 2 * st.gap; endPad = st.bar + st.gap + 0.1; }
  else if (st.flush) { pitch = r.Lx + 2 * st.rim + st.gap; zp = 0.32 * r.W; }
  else if (st.bead) { pitch = r.Lx + st.gap; zp = 0.34 * r.W; endPad = 0.4; }
  else { pitch = r.Lx + st.gap; }
  const outline = stoneOutline(b.shape, r);
  // metal a flush seat removes (crown + a cone for the pavilion), per stone
  const seatVol = st.flush ? polyArea(outline) * (r.hc + 0.05 + r.hp / 3) : 0;
  return { ...r, shape: b.shape, setting: b.setting, st, channel, channelW, channelD, pitch, prong, rp, zp, girdleBelow, endPad, outline, seatVol };
}
const dedupe = (arr) => arr.filter((y, i) => i === 0 || Math.abs(y - arr[i - 1]) > 1e-6);
function buildSection(b) {
  const ri = usToDiameter(b.size) / 2;
  if (b.profile === "custom" && CUSTOM) return customSection(b, ri);
  const w = b.width, hw = w / 2;
  const st = stoneSpec(b);
  const cw = st && st.channel ? st.channelW / 2 : 0;
  const zoneBounds = zoneBoundsOf(b);
  // outer samples, including the channel edges and zone boundaries exactly
  const ys = []; const N = b.wave > 0 ? 96 : 40;
  for (let i = 0; i <= N; i++) ys.push(-hw + w * i / N);
  if (cw) ys.push(-cw, cw);
  ys.push(...zoneBounds);
  ys.sort((a, c) => a - c);
  let outer = dedupe(ys).map((y) => ({ x: outerRadius(b, ri, y), y, o: true }));
  // inner samples (y falling)
  const M = b.interior === "comfort" || b.profile === "round" ? 24 : 1;
  const iys = []; for (let i = 0; i <= M; i++) iys.push(hw - w * i / M);
  iys.push(...zoneBounds); iys.sort((a, c) => c - a);
  const inner = dedupe(iys).map((y) => ({ x: innerRadius(b, ri, y), y }));
  // edge treatment: trim room for the fillet / chamfer, then tag the corners
  const eL = edgeTreatment(b, -1), eR = edgeTreatment(b, 1);
  const lim = cw ? 0.8 * (hw - cw) : Infinity;
  const dL = Math.min(eL.d, lim, 0.6 * (outer[0].x - inner[inner.length - 1].x));
  const dR = Math.min(eR.d, lim, 0.6 * (outer[outer.length - 1].x - inner[0].x));
  outer = trimEnd(trimEnd(outer, dL, true), dR, false);
  outer[0].edge = eL.mode; outer[0].r = dL;
  outer[outer.length - 1].edge = eR.mode; outer[outer.length - 1].r = dR;
  const fillet = Math.min(0.2, 0.12 * b.depth, 0.08 * w);
  let poly, floor = null;
  if (cw) {
    const iL = outer.findIndex((p) => Math.abs(p.y + cw) < 1e-6), iR = outer.findIndex((p) => Math.abs(p.y - cw) < 1e-6);
    poly = shapeCorners([...outer.slice(iR), ...inner, ...outer.slice(0, iL + 1)], fillet, false);
    floor = outer.slice(iL, iR + 1).map((p) => ({ x: p.x, y: p.y }));
  } else {
    const mid = Math.floor(inner.length / 2); // start the loop on the inner surface so every corner is interior
    poly = shapeCorners([...inner.slice(mid), ...outer, ...inner.slice(0, mid)], fillet, true);
  }
  return { ri, hw, runs: splitRuns(poly), floor, stone: st, zoneBounds, centerOuter: outerRadius(b, ri, 0), wave: waveSpec(b, zoneBounds, hw, st) };
}
// Decorative wave: a shallow groove meandering around the band, and/or a two-tone seam that follows it.
function waveSpec(b, zoneBounds, hw, st) {
  if (!(b.wave > 0) || b.profile === "custom") return null;
  const split = (b.wavemode === "split" || b.wavemode === "both") && b.zones === 2;
  const groove = b.wavemode === "groove" || b.wavemode === "both";
  const A = Math.min(b.wave, split ? 0.4 * minZoneWidth(b) : b.wave), f = b.wavef;
  const yb = split ? zoneBounds[0] : 0;
  const gc = groove ? (b.wavemode === "both" && b.zones === 2 ? zoneBounds[0] : 0) : 0;
  return { A, f, split, groove, yb, gc, hw, gw: 0.6, gd: Math.min(0.18, 0.12 * b.depth), cw: st && st.channel ? st.channelW / 2 : 0 };
}
// The section at one angle: channel floor depth, then the wave applied to the outer surface / the seam.
function sectionAt(sec, depth, th) {
  const runs = sectionRuns(sec, depth), wv = sec.wave;
  if (!wv) return runs;
  const off = wv.A * Math.sin(wv.f * th);
  const fade = (y) => { const d = y > wv.yb ? (y - wv.yb) / (wv.hw - wv.yb) : (wv.yb - y) / (wv.hw + wv.yb); return Math.max(0, 1 - d * d); };
  return runs.map((r) => r.map((p) => {
    let x = p.x, y = p.y;
    if (wv.groove && p.o && !(wv.cw && Math.abs(y) < wv.cw + 0.05)) { const u = (y - (wv.gc + off)) / (wv.gw / 2); if (Math.abs(u) < 1) x -= wv.gd * (1 - u * u); }
    if (wv.split) y += off * fade(p.y);
    return { x, y };
  }));
}
// Imported cross-section: the polygon is the whole section; x = radial offset from the inside, y along the axis.
function customSection(b, ri) {
  const pts = CUSTOM.pts.map((p) => ({ x: ri + p.x, y: p.y }));
  const n = pts.length, poly = [];
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n], p = pts[i], q = pts[(i + 1) % n];
    const ang = Math.abs(Math.atan2(q.y - p.y, q.x - p.x) - Math.atan2(p.y - a.y, p.x - a.x));
    const turn = Math.min(ang, Math.PI * 2 - ang);
    poly.push({ x: p.x, y: p.y, split: turn > 0.5 });
  }
  poly.push({ x: poly[0].x, y: poly[0].y });
  let outer = ri; for (const p of pts) if (Math.abs(p.y) < 0.25) outer = Math.max(outer, p.x);
  return { ri, hw: CUSTOM.width / 2, runs: splitRuns(poly), floor: null, stone: null, zoneBounds: zoneBoundsOf(b), centerOuter: outer, wave: null, custom: true };
}
function sectionRuns(sec, depth) {
  if (!sec.floor) return sec.runs;
  const fl = sec.floor.map((p) => ({ x: p.x - depth, y: p.y }));
  const top0 = sec.floor[0], top1 = sec.floor[sec.floor.length - 1];
  return [...sec.runs, [top0, fl[0]], fl, [fl[fl.length - 1], top1]];
}
const zoneOfY = (sec, y) => { let z = 0; for (const yb of sec.zoneBounds) if (y > yb) z++; return z; };
// Sutherland–Hodgman clip of a closed polygon to y0 ≤ y ≤ y1
function clipY(poly, y0, y1) {
  const at = (p, q, y) => { const t = (y - p.y) / (q.y - p.y); return { x: p.x + (q.x - p.x) * t, y }; };
  const clip = (pts, inside, y) => {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length], pi = inside(p), qi = inside(q);
      if (pi) out.push(p);
      if (pi !== qi) out.push(at(p, q, y));
    }
    return out;
  };
  return clip(clip(poly, (p) => p.y >= y0 - 1e-9, y0), (p) => p.y <= y1 + 1e-9, y1);
}
// Pappus: wedge volume = area × centroid radius × dθ
function wedgeVolume(loop, dTheta) {
  let A = 0, cx = 0;
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i], q = loop[(i + 1) % loop.length];
    const cr = p.x * q.y - q.x * p.y;
    A += cr; cx += (p.x + q.x) * cr;
  }
  A *= 0.5; if (Math.abs(A) > 1e-9) cx /= 6 * A;
  return Math.abs(A) * Math.abs(cx) * dTheta;
}

// ── Lathe with per-run normals, a channel whose depth varies with angle, and a material group per zone ──
const SEG = 192;
const TOP = Math.PI / 2; // lathe angle that ends up at the top of the standing ring
function buildRingGeometry(sec, b) {
  const depthAt = channelDepthFn(sec, b);
  const runs0 = sectionAt(sec, 0, 0);
  const counts = runs0.map((r) => r.length);
  const total = counts.reduce((a, c) => a + c, 0);
  const pos = new Float32Array((SEG + 1) * total * 3);
  const nor = new Float32Array((SEG + 1) * total * 3);
  const uv = new Float32Array((SEG + 1) * total * 2);
  let loopLen = 0;
  for (const r of runs0) for (let j = 1; j < r.length; j++) loopLen += Math.hypot(r[j].x - r[j - 1].x, r[j].y - r[j - 1].y);
  const volumes = Array.from({ length: b.zones }, () => 0);
  const dTheta = Math.PI * 2 / SEG;
  for (let sIdx = 0; sIdx <= SEG; sIdx++) {
    const th = sIdx / SEG * Math.PI * 2;
    const c = Math.cos(th), sn = Math.sin(th);
    const runs = sectionAt(sec, depthAt(th), th);
    const bOff = sec.wave && sec.wave.split ? sec.wave.A * Math.sin(sec.wave.f * th) : 0;
    let vi = sIdx * total, acc = 0;
    const loop = [];
    for (const r of runs) {
      for (let j = 0; j < r.length; j++) {
        const p = r[j];
        const a = r[Math.max(0, j - 1)], q = r[Math.min(r.length - 1, j + 1)];
        let tx = q.x - a.x, ty = q.y - a.y, l = Math.hypot(tx, ty);
        if (l < 1e-9) { tx = 0; ty = 1; l = 1; }
        const nx = ty / l, ny = -tx / l; // outward 2D normal
        pos[vi * 3] = p.x * c; pos[vi * 3 + 1] = p.y; pos[vi * 3 + 2] = -p.x * sn;
        nor[vi * 3] = nx * c; nor[vi * 3 + 1] = ny; nor[vi * 3 + 2] = -nx * sn;
        uv[vi * 2] = sIdx / SEG; uv[vi * 2 + 1] = acc / loopLen;
        if (j > 0) acc += Math.hypot(p.x - a.x, p.y - a.y);
        loop.push(p);
        vi++;
      }
    }
    if (sIdx < SEG) {
      if (b.zones === 1) volumes[0] += wedgeVolume(loop, dTheta);
      else for (let z = 0; z < b.zones; z++) {
        const y0 = z === 0 ? -1e9 : sec.zoneBounds[z - 1] + bOff, y1 = z === b.zones - 1 ? 1e9 : sec.zoneBounds[z] + bOff;
        volumes[z] += wedgeVolume(clipY(loop, y0, y1), dTheta);
      }
    }
  }
  // index buffer grouped by zone (material index)
  const byZone = Array.from({ length: b.zones }, () => []);
  for (let sIdx = 0; sIdx < SEG; sIdx++) {
    let base = 0;
    for (const r of runs0) {
      for (let j = 0; j < r.length - 1; j++) {
        const a = sIdx * total + base + j, bq = a + 1, c2 = a + total, d = c2 + 1;
        byZone[zoneOfY(sec, (r[j].y + r[j + 1].y) / 2)].push(a, c2, bq, bq, c2, d);
      }
      base += r.length;
    }
  }
  const idx = [];
  const g = new THREE.BufferGeometry();
  byZone.forEach((arr, z) => { g.addGroup(idx.length, arr.length, z); for (let i = 0; i < arr.length; i++) idx.push(arr[i]); });
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  // make sure winding agrees with the normals
  const pa = new THREE.Vector3().fromArray(pos, idx[0] * 3), pb = new THREE.Vector3().fromArray(pos, idx[1] * 3), pc = new THREE.Vector3().fromArray(pos, idx[2] * 3);
  const fn = pb.clone().sub(pa).cross(pc.clone().sub(pa));
  if (fn.dot(new THREE.Vector3().fromArray(nor, idx[0] * 3)) < 0) {
    for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  }
  g.setIndex(idx);
  g.computeBoundingSphere();
  return { geometry: g, volumes, loopLen, circumference: 2 * Math.PI * sec.centerOuter };
}
function stoneLayout(sec, b) {
  const st = sec.stone;
  if (!st) return null;
  const rg = sec.centerOuter - st.girdleBelow; // girdle radius
  const pitchAng = st.pitch / rg;
  const full = b.stones === "full";
  let n, start, ang;
  if (full) { n = Math.max(1, Math.floor(2 * Math.PI / pitchAng)); ang = 2 * Math.PI / n; start = 0; }
  else { n = Math.max(1, Math.floor(SPAN_ANGLE[b.stones] / pitchAng)); ang = pitchAng; start = TOP - (n - 1) / 2 * ang; }
  return { n, rg, full, ang, angles: Array.from({ length: n }, (_, i) => start + i * ang), pitchAng, halfSpan: full ? Math.PI : (n - 1) / 2 * ang,
    floor: sec.centerOuter - st.channelD, surface: sec.centerOuter, Lx: st.Lx, W: st.W, s: st.s };
}
function channelDepthFn(sec, b) {
  const st = sec.stone;
  if (!st || !st.channel) return () => 0;
  if (b.stones === "full") return () => st.channelD;
  const lay = stoneLayout(sec, b);
  const end = lay.halfSpan + (st.Lx / 2 + st.endPad) / lay.rg, ramp = 0.35 / lay.rg;
  return (th) => {
    let a = ((th - TOP + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    a = Math.abs(a);
    if (a <= end - ramp) return st.channelD;
    if (a >= end) return 0;
    const u = (end - a) / ramp;
    return st.channelD * u * u * (3 - 2 * u);
  };
}

// ── Low-poly mesher for stones and setting metal ─────────────────────────────
// Local frame of every part: X along the band, Y radial (up = out of the ring),
// Z across the band. Faces are oriented away from `ref` (a point inside the solid).
class Mesher {
  constructor() { this.pos = []; }
  tri(a, b, c, ref, inv) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const dot = nx * ((a[0] + b[0] + c[0]) / 3 - ref[0]) + ny * ((a[1] + b[1] + c[1]) / 3 - ref[1]) + nz * ((a[2] + b[2] + c[2]) / 3 - ref[2]);
    if ((dot < 0) !== !!inv) { const t = b; b = c; c = t; }
    this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  }
  quad(a, b, c, d, ref, inv) { this.tri(a, b, c, ref, inv); this.tri(a, c, d, ref, inv); }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(this.pos.length / 3 * 2), 2));
    g.computeVertexNormals();
    return g;
  }
}
const polyArea = (p) => { let A = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; A += a[0] * b[1] - b[0] * a[1]; } return Math.abs(A) / 2; };
const ellipsePoly = (n, a, b, p = 2) => Array.from({ length: n }, (_, i) => { const t = i / n * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
  return [a * Math.sign(c) * Math.pow(Math.abs(c), 2 / p), b * Math.sign(s) * Math.pow(Math.abs(s), 2 / p)]; });
const rectPoly = (hx, hz, cut) => cut > 0
  ? [[-hx + cut, -hz], [hx - cut, -hz], [hx, -hz + cut], [hx, hz - cut], [hx - cut, hz], [-hx + cut, hz], [-hx, hz - cut], [-hx, -hz + cut]]
  : [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]];
// Push a convex outline out by `off` (what a bezel rim does around a stone).
function offsetPolygon(pts, off) {
  const n = pts.length, out = [];
  const cx = pts.reduce((a, p) => a + p[0], 0) / n, cz = pts.reduce((a, p) => a + p[1], 0) / n;
  const norm = (p, q) => { let dx = q[0] - p[0], dz = q[1] - p[1]; const l = Math.hypot(dx, dz); let nx = dz / l, nz = -dx / l;
    if (nx * (p[0] - cx) + nz * (p[1] - cz) < 0) { nx = -nx; nz = -nz; } return [nx, nz]; };
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n], p = pts[i], b = pts[(i + 1) % n];
    const n1 = norm(a, p), n2 = norm(p, b);
    let bx = n1[0] + n2[0], bz = n1[1] + n2[1]; const l = Math.hypot(bx, bz) || 1; bx /= l; bz /= l;
    const k = off / Math.max(0.5, bx * n1[0] + bz * n1[1]);
    out.push([p[0] + bx * k, p[1] + bz * k]);
  }
  return out;
}
function stoneOutline(shape, dm) {
  const s = dm.s, W = dm.W, Lx = dm.Lx;
  switch (shape) {
    case "princess": return rectPoly(s / 2, s / 2, 0.08 * s);
    case "cushion":  return ellipsePoly(24, Lx / 2, W / 2, 3.2);
    case "emerald":  return rectPoly(Lx / 2, W / 2, 0.18 * s);
    case "baguette": return rectPoly(Lx / 2, W / 2, 0);
    default:         return ellipsePoly(16, s / 2, s / 2);
  }
}
// A cut stone: table, crown steps, a girdle with thickness, pavilion steps and
// either a point (brilliants) or a keel line (step cuts).
function stoneGeometry(shape, dm) {
  const s = dm.s, outline = stoneOutline(shape, dm);
  const P = {
    round:    { crown: [[0.82, 0.06], [0.56, 0.16]], pav: [[0.6, -0.22]], apex: -0.44 },
    princess: { crown: [[0.8, 0.06], [0.62, 0.12]], pav: [[0.55, -0.3]], apex: -0.58 },
    cushion:  { crown: [[0.85, 0.06], [0.58, 0.14]], pav: [[0.5, -0.26]], apex: -0.51 },
    emerald:  { crown: [[0.88, 0.05], [0.74, 0.10], [0.6, 0.15]], pav: [[0.8, -0.15], [0.55, -0.32]], apex: -0.5, keel: 0.25 * dm.W },
    baguette: { crown: [[0.8, 0.06], [0.6, 0.12]], pav: [[0.6, -0.25]], apex: -0.48, keel: 0.3 * dm.W },
  }[shape];
  const M = new Mesher(), ref = [0, (P.crown[P.crown.length - 1][1] + P.apex) / 2 * s, 0];
  const ring = (sc, y) => outline.map(([x, z]) => [x * sc, y, z * sc]);
  const gt = 0.015 * s;
  const rings = [...[...P.crown].reverse().map(([sc, y]) => ring(sc, y * s)), ring(1, gt), ring(1, -gt), ...P.pav.map(([sc, y]) => ring(sc, y * s))];
  const n = outline.length, top = rings[0];
  for (let i = 1; i < n - 1; i++) M.tri(top[0], top[i], top[i + 1], ref);
  for (let k = 0; k < rings.length - 1; k++) { const A = rings[k], B = rings[k + 1]; for (let i = 0; i < n; i++) M.quad(A[i], A[(i + 1) % n], B[(i + 1) % n], B[i], ref); }
  const last = rings[rings.length - 1], ay = P.apex * s;
  if (!P.keel) { const X = [0, ay, 0]; for (let i = 0; i < n; i++) M.tri(last[i], last[(i + 1) % n], X, ref); }
  else {
    const K1 = [0, ay, -P.keel], K2 = [0, ay, P.keel], kp = (p) => (p[2] < 0 ? K1 : K2);
    for (let i = 0; i < n; i++) { const a = last[i], b = last[(i + 1) % n]; M.tri(a, b, kp(a), ref); if (kp(a) !== kp(b)) M.tri(b, kp(b), kp(a), ref); }
  }
  return M.geometry();
}
// Solid prism between radii y0..y1 (star-shaped outline, fan caps).
function prismGeometry(outline, y0, y1) {
  const M = new Mesher(), ref = [0, (y0 + y1) / 2, 0], n = outline.length;
  const lo = outline.map(([x, z]) => [x, y0, z]), hi = outline.map(([x, z]) => [x, y1, z]);
  for (let i = 0; i < n; i++) { M.quad(lo[i], lo[(i + 1) % n], hi[(i + 1) % n], hi[i], ref); M.tri([0, y1, 0], hi[i], hi[(i + 1) % n], ref); M.tri([0, y0, 0], lo[i], lo[(i + 1) % n], ref); }
  return M.geometry();
}
// Ring of metal (bezel rim) between two outlines, radii y0..y1.
function annulusGeometry(outer, inner, y0, y1) {
  const M = new Mesher(), ref = [0, (y0 + y1) / 2, 0], n = outer.length;
  const O0 = outer.map(([x, z]) => [x, y0, z]), O1 = outer.map(([x, z]) => [x, y1, z]), I0 = inner.map(([x, z]) => [x, y0, z]), I1 = inner.map(([x, z]) => [x, y1, z]);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    M.quad(O0[i], O0[j], O1[j], O1[i], ref);
    M.quad(I0[i], I0[j], I1[j], I1[i], ref, true);
    M.quad(O1[i], O1[j], I1[j], I1[i], [0, y0 - 10, 0]);
    M.quad(O0[i], O0[j], I0[j], I0[i], [0, y1 + 10, 0]);
  }
  return M.geometry();
}
// Prong: a post from `base` to a domed tip at `tip`, radius rp.
function prongGeometry(rp, base, tip) {
  const pts = [[0, base], [rp, base], [rp, tip - rp], [0.6 * rp, tip - 0.3 * rp], [0, tip]].map(([x, y]) => new THREE.Vector2(x, y));
  const g = new THREE.LatheGeometry(pts, 12); g.computeVertexNormals();
  return { geometry: g, volume: Math.PI * rp * rp * (tip - base) };
}
// ── Finish textures ──────────────────────────────────────────────────────────
// Height fields at real scale (one tile = FINISHES[].tile mm), turned into
// tangent-space normal maps, so the brush grain, hammer facets and sandblast
// grit are lit by the studio like the metal itself.
const TEX = 512;
let texSeed = 11;
const rnd = () => (texSeed = (texSeed * 16807) % 2147483647) / 2147483647;
function heightToNormal(h, n, strength) {
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const l = h[y * n + (x + n - 1) % n], r = h[y * n + (x + 1) % n];
    const u = h[((y + n - 1) % n) * n + x], d = h[((y + 1) % n) * n + x];
    let nx = (l - r) * strength, ny = (d - u) * strength, nz = 1;
    const len = Math.hypot(nx, ny, nz); nx /= len; ny /= len; nz /= len;
    const i = (y * n + x) * 4;
    data[i] = (nx * 0.5 + 0.5) * 255; data[i + 1] = (ny * 0.5 + 0.5) * 255; data[i + 2] = (nz * 0.5 + 0.5) * 255; data[i + 3] = 255;
  }
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.needsUpdate = true;
  return t;
}
// Hammered: overlapping spherical dimples; where they meet, a crisp ridge.
function hammeredHeight(n) {
  const h = new Float32Array(n * n).fill(1);
  const dimples = [];
  for (let i = 0; i < 48; i++) dimples.push({ x: rnd() * n, y: rnd() * n, r: n * (0.09 + rnd() * 0.07), d: 0.5 + rnd() * 0.5 });
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let best = 1;
    for (const q of dimples) {
      let dx = Math.abs(x - q.x), dy = Math.abs(y - q.y);
      dx = Math.min(dx, n - dx); dy = Math.min(dy, n - dy);
      const t = (dx * dx + dy * dy) / (q.r * q.r);
      if (t < 1) best = Math.min(best, 1 - q.d * (1 - t) * (1 - t * 0.35));
    }
    h[y * n + x] = best;
  }
  return h;
}
// Satin: parallel brush lines around the band — two scales of line noise so
// the grain survives mip-filtering, broken into short strokes along the line.
function satinHeight(n) {
  const knots = (k) => { const v = new Float32Array(n); const K = Math.ceil(n / k) + 1, r = Array.from({ length: K }, rnd);
    for (let y = 0; y < n; y++) { const i = y / k, i0 = Math.floor(i), t = i - i0; v[y] = r[i0 % K] * (1 - t) + r[(i0 + 1) % K] * t; } return v; };
  const coarse = knots(16), fine = knots(5);
  const h = new Float32Array(n * n);
  for (let y = 0; y < n; y++) {
    const line = 0.55 * coarse[y] + 0.35 * fine[y];
    let pos = 0, amp = 1;
    for (let x = 0; x < n; x++) {
      if (x >= pos) { pos = x + 40 + rnd() * 120; amp = 0.25 + rnd() * 0.75; }
      h[y * n + x] = 0.5 + (line - 0.45) * amp + (rnd() - 0.5) * 0.08;
    }
  }
  return h;
}
// Matte: sandblast grit — white noise, lightly smoothed.
function matteHeight(n) {
  const raw = new Float32Array(n * n); for (let i = 0; i < raw.length; i++) raw[i] = rnd();
  const h = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    h[y * n + x] = 0.5 * raw[y * n + x] + 0.125 * (raw[y * n + (x + 1) % n] + raw[y * n + (x + n - 1) % n] + raw[((y + 1) % n) * n + x] + raw[((y + n - 1) % n) * n + x]);
  }
  return h;
}
// Brushed-linear: the satin lines turned across the band.
function brushedHeight(n) { const h = satinHeight(n), t = new Float32Array(n * n); for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) t[y * n + x] = h[x * n + y]; return t; }
// Sandblast: coarse grit — clustered white noise with occasional deeper pits.
function sandblastHeight(n) {
  const h = matteHeight(n);
  for (let i = 0; i < 2600; i++) { const cx = (rnd() * n) | 0, cy = (rnd() * n) | 0, r = 1 + (rnd() * 2) | 0, d = 0.5 + rnd() * 0.5;
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r) { const i2 = ((cy + y + n) % n) * n + (cx + x + n) % n; h[i2] = Math.max(0, h[i2] - d * (1 - (x * x + y * y) / (r * r + 1))); } }
  return h;
}
// Ice: fine crystalline facets — each pixel's height is set by its nearest seed, so cells meet in crisp ridges.
function iceHeight(n) {
  const seeds = Array.from({ length: 160 }, () => ({ x: rnd() * n, y: rnd() * n, h: rnd(), t: rnd() * 6.28 }));
  const h = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let best = 1e9, s = seeds[0];
    for (const q of seeds) { let dx = Math.abs(x - q.x), dy = Math.abs(y - q.y); dx = Math.min(dx, n - dx); dy = Math.min(dy, n - dy); const d = dx * dx + dy * dy; if (d < best) { best = d; s = q; } }
    // a flat tilted facet per cell
    let ex = x - s.x, ey = y - s.y; if (ex > n / 2) ex -= n; if (ex < -n / 2) ex += n; if (ey > n / 2) ey -= n; if (ey < -n / 2) ey += n;
    h[y * n + x] = 0.5 + 0.25 * (s.h - 0.5) + 0.004 * (ex * Math.cos(s.t) + ey * Math.sin(s.t));
  }
  return h;
}
// Bark: long wandering ridges along the band with fine grain, like tree bark or a mokume texture.
function barkHeight(n) {
  const h = new Float32Array(n * n);
  const k1 = Array.from({ length: 8 }, rnd), k2 = Array.from({ length: 8 }, rnd);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = x / n * Math.PI * 2, v = y / n * Math.PI * 2;
    let r = 0; for (let i = 0; i < 8; i++) r += Math.sin(v * (3 + i) + Math.sin(u * (1 + (i % 3)) + k1[i] * 6.28) * 1.4 + k2[i] * 6.28) / (1 + i * 0.6);
    h[y * n + x] = 0.5 + 0.22 * Math.tanh(r) + (rnd() - 0.5) * 0.06;
  }
  return h;
}
// Brushed metal reads as streaks of changing sheen more than as grooves, so
// satin also gets a roughness map (green channel) from the same lines.
function heightToRoughness(h, n, lo, hi) {
  const data = new Uint8Array(n * n * 4);
  for (let i = 0; i < n * n; i++) { const v = Math.min(1, Math.max(0, h[i])); data[i * 4 + 1] = (lo + (hi - lo) * v) * 255; data[i * 4 + 3] = 255; }
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.needsUpdate = true;
  return t;
}
const FINISH_MAPS = {};
function finishMap(key) {
  if (!FINISH_MAPS[key]) {
    if (key === "satin") { const h = satinHeight(TEX); FINISH_MAPS.satin = heightToNormal(h, TEX, 3.2); FINISH_MAPS.satinRough = heightToRoughness(h, TEX, 0.12, 0.5); }
    else if (key === "hammered") FINISH_MAPS.hammered = heightToNormal(hammeredHeight(TEX), TEX, 2.0);
    else if (key === "matte") FINISH_MAPS.matte = heightToNormal(matteHeight(TEX), TEX, 1.6);
    else if (key === "brushed") { const h = brushedHeight(TEX); FINISH_MAPS.brushed = heightToNormal(h, TEX, 3.2); FINISH_MAPS.brushedRough = heightToRoughness(h, TEX, 0.12, 0.5); }
    else if (key === "sandblast") FINISH_MAPS.sandblast = heightToNormal(sandblastHeight(TEX), TEX, 2.2);
    else if (key === "ice") FINISH_MAPS.ice = heightToNormal(iceHeight(TEX), TEX, 3.0);
    else if (key === "bark") FINISH_MAPS.bark = heightToNormal(barkHeight(TEX), TEX, 2.4);
  }
  return FINISH_MAPS[key];
}
function drawEngraving(canvas, text, font) {
  const x = canvas.getContext("2d");
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.clearRect(0, 0, canvas.width, canvas.height);
  if (!text) return;
  x.save();
  x.translate(0, canvas.height); x.scale(1, -1); // reads upright on the inside of the band
  x.font = FONTS[font] || FONTS.script;
  x.textAlign = "center"; x.textBaseline = "middle";
  const maxW = canvas.width * 0.5;
  const w = x.measureText(text).width;
  if (w > maxW) x.scale(maxW / w, 1);
  x.fillStyle = "rgba(38,32,26,0.88)";
  x.fillText(text, canvas.width / 2 * (w > maxW ? w / maxW : 1), canvas.height / 2 + 4);
  x.restore();
}

// ── Scene ────────────────────────────────────────────────────────────────────
const viewer = document.getElementById("bbViewer");
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping; // what the Moksh Diam viewer ships (TonemapPlugin default), exposure 1.0 for the next look
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
viewer.appendChild(renderer.domElement);

const scene = new THREE.Scene();
// ── Moksh Diam materials ─────────────────────────────────────────────────────
// Ported from the Moksh Diam viewer (moksh-azoir: studioEnv.ts, metalFresnel.ts,
// metalShading.ts, JewelryViewer GEM_CONFIGS) so a band looks the same here, in
// the portal viewer and in the try-on. Metal colours are MatrixGold's rendered
// swatches; the metal reflects a procedural light tent; the Fresnel is a
// measured conductor curve, not Schlick; the diamond is the viewer's config.
const ALLOY_OF = { "14y": "yellow_gold", "18y": "yellow_gold", "14w": "white_gold", "18w": "white_gold", "14r": "rose_gold", "18r": "rose_gold", pt: "platinum" };
const WARM = [1.0, 0.93, 0.84], NEUTRAL = [1, 1, 1], COOL = [0.93, 0.97, 1.0];
const GEM_STUDIO = {
  room: [0.42, 0.56, 0], floorBelow: -13.5,
  lobes: [{ dir: [1, 0.25, 0], power: -0.6, exponent: 1.8 }],
  bands: [{ lat: -8, width: 4, power: 0.2 }],
  boxes: [
    { dir: [0.993, 0.12, -0.05], size: [44, 42], power: 1.75, soft: 0.06 },
    { dir: [0.79, 0.12, -0.6], size: [22, 22], power: 0.85, soft: 0.95 },
    { dir: [0.84, 0.12, 0.53], size: [22, 22], power: 0.85, soft: 0.95 },
  ],
};
const STUDIOS = {
  gold: {
    room: [0.95, 1.15, 0.22], roomTint: WARM,
    boxes: [
      { dir: [0, 1, 0.05], size: [90, 60], power: 1.2, tint: NEUTRAL, soft: 0.5 },
      { dir: [-0.9, 0.1, 0.42], size: [18, 75], power: -0.93, soft: 0.2 },
      { dir: [0.9, 0.1, 0.42], size: [18, 75], power: -0.93, soft: 0.2 },
      { dir: [0, 0.12, 1], size: [16, 12], power: -0.55, soft: 0.5 },
      { dir: [0, 0.22, -1], size: [120, 14], power: -0.93, soft: 0.25 },
      { dir: [0.35, 0.75, 0.56], size: [40, 18], power: 2.6, tint: WARM, soft: 0.3 },
    ],
  },
  white: {
    room: [0.95, 1.15, 0.18], roomTint: COOL,
    boxes: [
      { dir: [0, 1, 0.05], size: [90, 60], power: 1.2, tint: NEUTRAL, soft: 0.5 },
      { dir: [-0.9, 0.1, 0.42], size: [16, 75], power: -0.94, soft: 0.15 },
      { dir: [0.9, 0.1, 0.42], size: [16, 75], power: -0.94, soft: 0.15 },
      { dir: [0, 0.12, 1], size: [16, 12], power: -0.6, soft: 0.5 },
      { dir: [0, 0.22, -1], size: [120, 12], power: -0.94, soft: 0.2 },
      { dir: [0.35, 0.75, 0.56], size: [40, 18], power: 2.8, tint: NEUTRAL, soft: 0.3 },
    ],
  },
  gem: GEM_STUDIO,
};
const v3norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const v3cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function softEdge(x, h, soft) {
  const a = Math.abs(x);
  if (soft <= 0) return a < h ? 1 : 0;
  const inner = h * (1 - soft);
  if (a <= inner) return 1;
  if (a >= h) return 0;
  const t = (a - inner) / (h - inner);
  return 1 - t * t * (3 - 2 * t);
}
// A preset → linear RGBA float equirect (row 0 = bottom), as in studioEnv.ts.
function renderStudio(preset, width = 512) {
  const height = width / 2, data = new Float32Array(width * height * 4);
  const boxes = preset.boxes.map((b) => {
    const f = v3norm(b.dir);
    const ref = Math.abs(f[1]) > 0.98 ? [0, 0, 1] : [0, 1, 0];
    const r = v3norm(v3cross(ref, f)), u = v3cross(f, r);
    return { f, r, u, hw: Math.tan(b.size[0] / 2 * Math.PI / 180), hh: Math.tan(b.size[1] / 2 * Math.PI / 180), soft: b.soft ?? 0.3, power: b.power, tint: b.tint || [1, 1, 1] };
  });
  const [horizon, zenith, nadir] = preset.room, rt = preset.roomTint || [1, 1, 1];
  const lobes = (preset.lobes || []).map((l) => ({ ...l, d: v3norm(l.dir) })), bands = preset.bands || [];
  const floorSin = preset.floorBelow !== undefined ? Math.sin(preset.floorBelow * Math.PI / 180) : -2;
  for (let j = 0; j < height; j++) {
    const lat = ((j + 0.5) / height - 0.5) * Math.PI, cy = Math.sin(lat), cl = Math.cos(lat);
    let room = cy < floorSin ? 0 : cy >= 0 ? horizon + (zenith - horizon) * cy : horizon + (nadir - horizon) * -cy;
    const latDeg = lat * 180 / Math.PI;
    for (const b of bands) room += b.power * Math.exp(-0.5 * ((latDeg - b.lat) / b.width) ** 2);
    for (let i = 0; i < width; i++) {
      const phi = ((i + 0.5) / width - 0.5) * Math.PI * 2, dx = cl * Math.cos(phi), dz = cl * Math.sin(phi);
      let R = room * rt[0], G = room * rt[1], B = room * rt[2];
      for (const l of lobes) { const c = dx * l.d[0] + cy * l.d[1] + dz * l.d[2]; if (c > 0) { const p = l.power * Math.pow(c, l.exponent); R += p * rt[0]; G += p * rt[1]; B += p * rt[2]; } }
      for (const b of boxes) {
        const fd = dx * b.f[0] + cy * b.f[1] + dz * b.f[2];
        if (fd <= 0.05) continue;
        const x = (dx * b.r[0] + cy * b.r[1] + dz * b.r[2]) / fd, y = (dx * b.u[0] + cy * b.u[1] + dz * b.u[2]) / fd;
        const w = softEdge(x, b.hw, b.soft) * softEdge(y, b.hh, b.soft);
        if (w <= 0) continue;
        const rx = x / b.hw, ry = y / b.hh, p = b.power * w * (1 - 0.18 * (rx * rx + ry * ry));
        R += p * b.tint[0]; G += p * b.tint[1]; B += p * b.tint[2];
      }
      const o = (j * width + i) * 4;
      data[o] = Math.max(R, 1e-4); data[o + 1] = Math.max(G, 1e-4); data[o + 2] = Math.max(B, 1e-4); data[o + 3] = 1;
    }
  }
  return { data, width, height };
}
const studioCache = {};
function studioTexture(key) {
  if (studioCache[key]) return studioCache[key];
  const { data, width, height } = renderStudio(STUDIOS[key], 1024);
  const half = new Uint16Array(data.length);
  for (let i = 0; i < data.length; i++) half[i] = THREE.DataUtils.toHalfFloat(Math.min(data[i], 65000));
  const tex = new THREE.DataTexture(half, width, height, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping; tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.magFilter = tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
  return (studioCache[key] = tex);
}
const familyForMetal = (key) => (ALLOY_OF[key] === "yellow_gold" || ALLOY_OF[key] === "rose_gold" ? "gold" : "white");

// Conductor Fresnel (Gulbrandsen 2014) from published n/k of the alloy's dominant metal.
const OPTICAL_CONSTANTS = {
  Au: { n: [0.156, 0.424, 1.383], k: [3.602, 2.472, 1.916] },
  Ag: { n: [0.052, 0.060, 0.040], k: [4.409, 3.597, 2.648] },
  Cu: { n: [0.238, 1.007, 1.240], k: [3.626, 2.582, 2.393] },
  Pt: { n: [2.369, 2.089, 1.850], k: [4.252, 3.698, 3.138] },
  Rh: { n: [2.190, 1.967, 1.751], k: [5.740, 5.015, 4.452] },
};
const ALLOY_EDGE_SOURCE = { yellow_gold: [["Au", 1]], rose_gold: [["Au", 0.75], ["Cu", 0.25]], white_gold: [["Rh", 1]], platinum: [["Pt", 1]] };
const reflectivityFromNK = (n, k) => ((n - 1) ** 2 + k * k) / ((n + 1) ** 2 + k * k);
function edgeTintFromNK(n, k) {
  const r = Math.min(reflectivityFromNK(n, k), 0.9999), nMin = (1 - r) / (1 + r), sr = Math.sqrt(r), nMax = (1 + sr) / (1 - sr);
  return Math.min(1, Math.max(0, (nMax - n) / (nMax - nMin)));
}
function nkFromReflectivityEdgeTint(r, g) {
  const rc = Math.min(Math.max(r, 0), 0.9999), sr = Math.sqrt(rc);
  const n = g * ((1 - rc) / (1 + rc)) + (1 - g) * ((1 + sr) / (1 - sr));
  const k2 = ((n + 1) ** 2 * rc - (n - 1) ** 2) / (1 - rc);
  return { n, k: Math.sqrt(Math.max(k2, 0)) };
}
function alloyComplexIor(alloy, hex) {
  const c = new THREE.Color(hex); // sRGB hex → linear (three's colour management)
  const r = [c.r, c.g, c.b], g = [0, 0, 0];
  for (const [metal, w] of ALLOY_EDGE_SOURCE[alloy] || ALLOY_EDGE_SOURCE.white_gold) {
    const { n, k } = OPTICAL_CONSTANTS[metal];
    for (let i = 0; i < 3; i++) g[i] += w * edgeTintFromNK(n[i], k[i]);
  }
  const eta = [0, 0, 0], k = [0, 0, 0];
  for (let i = 0; i < 3; i++) { const v = nkFromReflectivityEdgeTint(r[i], g[i]); eta[i] = v.n; k[i] = v.k; }
  return { eta, k };
}
const CONDUCTOR_FRESNEL_GLSL = `
uniform vec3 metalEta;
uniform vec3 metalK;
vec3 fresnelConductor(float cosi, vec3 eta, vec3 k) {
  cosi = clamp(cosi, 0.0, 1.0);
  float c2 = cosi * cosi, s2 = 1.0 - c2;
  vec3 e2 = eta * eta, k2 = k * k;
  vec3 t0 = e2 - k2 - s2;
  vec3 a2b2 = sqrt(t0 * t0 + 4.0 * e2 * k2);
  vec3 t1 = a2b2 + c2;
  vec3 a = sqrt(max(0.5 * (a2b2 + t0), 0.0));
  vec3 t2 = 2.0 * cosi * a;
  vec3 rs = (t1 - t2) / (t1 + t2);
  vec3 t3 = c2 * a2b2 + s2 * s2;
  vec3 t4 = t2 * s2;
  vec3 rp = rs * (t3 - t4) / (t3 + t4);
  return 0.5 * (rp + rs);
}
vec3 conductorFssEss(vec2 fab) {
  float ess = max(fab.x + fab.y, 1e-4);
  float cosEff = 1.0 - pow(clamp(fab.y / ess, 0.0, 1.0), 0.2);
  return fresnelConductor(cosEff, metalEta, metalK) * ess;
}
float mdHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float mdNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(mdHash(i), mdHash(i + vec3(1,0,0)), f.x), mix(mdHash(i + vec3(0,1,0)), mdHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(mdHash(i + vec3(0,0,1)), mdHash(i + vec3(1,0,1)), f.x), mix(mdHash(i + vec3(0,1,1)), mdHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}`;
// Patch a MeshPhysicalMaterial with the conductor Fresnel and the viewer's micro-roughness (world mm).
function mokshMetal(mat) {
  mat.userData.eta = { value: new THREE.Vector3(1, 1, 1) };
  mat.userData.k = { value: new THREE.Vector3(1, 1, 1) };
  mat.userData.micro = { value: 0.03 };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.metalEta = mat.userData.eta; shader.uniforms.metalK = mat.userData.k; shader.uniforms.mdMicro = mat.userData.micro;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vMdWorld;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n  vMdWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vMdWorld;\nuniform float mdMicro;\n" + CONDUCTOR_FRESNEL_GLSL)
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\n  roughnessFactor = clamp(roughnessFactor + (mdNoise(vMdWorld * 18.0) - 0.5) * mdMicro, 0.0, 1.0);")
      .replace("#include <lights_physical_pars_fragment>", THREE.ShaderChunk.lights_physical_pars_fragment
        .replace("vec3 FssEss = Fr * fab.x + specularF90 * fab.y;", "vec3 FssEss = conductorFssEss(fab);")
        .split("vec3 F = F_Schlick( f0, f90, dotVH );").join("vec3 F = fresnelConductor( dotVH, metalEta, metalK );"));
  };
  mat.customProgramCacheKey = () => "moksh-metal";
  return mat;
}
function setAlloy(mat, metalKey) {
  const met = METALS[metalKey], { eta, k } = alloyComplexIor(ALLOY_OF[metalKey], met.color);
  mat.color.set(met.color);
  mat.userData.eta.value.set(...eta); mat.userData.k.value.set(...k);
}

// The metal reflects the Moksh Diam light tent (gold or white family, by the first zone's alloy);
// the stones reflect the viewer's gem studio with their own strength.
const pmrem = new THREE.PMREMGenerator(renderer);
const envCache = {};
function envFor(key) { return envCache[key] || (envCache[key] = pmrem.fromEquirectangular(studioTexture(key)).texture); }
scene.environment = envFor("gold");
scene.environmentIntensity = 1.0;
let envFamily = "gold";
function setEnvFamily(f) { if (f !== envFamily) { envFamily = f; scene.environment = envFor(f); } }
// A real cast shadow on the ground (the light itself adds nothing: direct light on mirror metal is one white blob).
const GROUND_Y = -11.5;
const sun = new THREE.DirectionalLight(0xffffff, 0.001);
sun.position.set(-22, 46, 26); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); sun.shadow.radius = 5; sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 140 });
scene.add(sun, sun.target);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.ShadowMaterial({ color: 0x1b2232, opacity: 0.26 }));
ground.rotation.x = -Math.PI / 2; ground.position.y = GROUND_Y; ground.receiveShadow = true;
scene.add(ground);

const camera = new THREE.PerspectiveCamera(28, 1, 1, 500);
camera.position.set(30, 21, 46);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.enablePan = false; controls.minDistance = 30; controls.maxDistance = 120;
controls.target.set(0, -0.8, 0);
controls.autoRotate = true; controls.autoRotateSpeed = 0.9;
controls.maxPolarAngle = Math.PI * 0.6; controls.minPolarAngle = Math.PI * 0.15;
let idleTimer = 0;
controls.addEventListener("start", () => { controls.autoRotate = false; clearTimeout(idleTimer); });
controls.addEventListener("end", () => { idleTimer = setTimeout(() => (controls.autoRotate = true), 7000); });
// Lit by the environment alone: a direct light on near-mirror metal is one
// enormous highlight that tone-maps the whole band to white.

const LEAN = Math.PI / 2 + 0.22; // lathe axis Y → mostly Z: the ring stands, its top tipped toward the viewer
const PAIR_GAP = 3; // mm between the two rings
// Diamond: the Moksh Diam viewer's config (JewelryViewer GEM_CONFIGS.diamond), reflecting its gem studio.
const stoneMat = new THREE.MeshPhysicalMaterial({
  color: 0xffffff, metalness: 0, roughness: 0, ior: 2.42, transmission: 0.9, thickness: 2.0,
  attenuationColor: new THREE.Color(0xffffff), attenuationDistance: 4.0, clearcoat: 1.0, clearcoatRoughness: 0,
  specularIntensity: 3.0, envMapIntensity: 4, flatShading: true,
});
stoneMat.envMap = envFor("gem");
const shadowC = document.createElement("canvas"); shadowC.width = shadowC.height = 256;
{ const x = shadowC.getContext("2d"); const g = x.createRadialGradient(128, 128, 10, 128, 128, 128);
  g.addColorStop(0, "rgba(20,24,40,0.3)"); g.addColorStop(0.5, "rgba(20,24,40,0.1)"); g.addColorStop(1, "rgba(20,24,40,0)");
  x.fillStyle = g; x.fillRect(0, 0, 256, 256); }
const shadowTex = new THREE.CanvasTexture(shadowC);

// One rendered band: ring (one material per zone), stones, setting parts, engraving, contact shadow.
class BandView {
  constructor() {
    this.group = new THREE.Group(); this.group.rotation.x = LEAN; scene.add(this.group);
    this.mats = [0, 1, 2].map(() => mokshMetal(new THREE.MeshPhysicalMaterial({ metalness: 1, roughness: 0.04, envMapIntensity: 1 })));
    this.maps = [{}, {}, {}]; // per zone, per finish: a clone of the shared normal map with its own repeat
    this.engraveMat = new THREE.MeshBasicMaterial({ transparent: true, side: THREE.BackSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.engraveCanvas = document.createElement("canvas"); this.engraveCanvas.width = 2048; this.engraveCanvas.height = 160;
    this.engraveTex = new THREE.CanvasTexture(this.engraveCanvas); this.engraveTex.anisotropy = 8; this.engraveTex.colorSpace = THREE.SRGBColorSpace;
    this.engraveMat.map = this.engraveTex;
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2; scene.add(this.shadow);
    this.parts = [];
    this.metrics = { grams: 0, zoneGrams: [0], stones: 0, carats: 0, stoneMm: 0, outer: 10, circumference: 0, loopLen: 1 };
    this.sec = null; this.built = null; this.layout = null;
  }
  setVisible(v) { this.group.visible = v; this.shadow.visible = v; }
  setOffset(x) { this.group.position.x = x; this.shadow.position.x = x; }
  clear() {
    for (const m of this.parts) { m.geometry.dispose(); this.group.remove(m); }
    this.parts = [];
  }
  build(b) {
    this.clear();
    const sec = this.sec = buildSection(b);
    const built = this.built = buildRingGeometry(sec, b);
    const ring = new THREE.Mesh(built.geometry, this.mats);
    ring.castShadow = true;
    this.group.add(ring); this.parts.push(ring);
    this.metrics.circumference = built.circumference; this.metrics.loopLen = built.loopLen;

    const lay = this.layout = stoneLayout(sec, b);
    const partsVol = Array.from({ length: b.zones }, () => 0);
    const zc = zoneOfY(sec, 0);
    const m = new THREE.Matrix4(), tv = new THREE.Vector3(), rv = new THREE.Vector3(), av = new THREE.Vector3(0, -1, 0), sv = new THREE.Vector3();
    // Part frame at angle th: local X along the band, Y radial (out), Z across the band (world −y).
    const at = (th, r, xOff = 0, zOff = 0, sx = 1, sy = 1, sz = 1) => {
      const c = Math.cos(th), s = Math.sin(th);
      tv.set(-s, 0, -c); rv.set(c, 0, -s);
      m.makeBasis(tv, rv, av);
      m.setPosition(rv.x * r + tv.x * xOff, -zOff, rv.z * r + tv.z * xOff);
      if (sx !== 1 || sy !== 1 || sz !== 1) m.scale(sv.set(sx, sy, sz));
      return m;
    };
    const inst = (geom, mat, count, fill, vol, zone) => {
      if (count <= 0) return;
      const im = new THREE.InstancedMesh(geom, mat, count);
      fill(im); im.instanceMatrix.needsUpdate = true; im.castShadow = true;
      this.group.add(im); this.parts.push(im);
      partsVol[zone] += vol * count;
    };
    let setDetail = "", setLimits = "";
    if (lay) {
      const st = sec.stone, n = lay.n, H = st.channelD + 0.02, floor = lay.floor - 0.01, mid = floor + H / 2, surf = lay.surface;
      const gapAngles = Array.from({ length: lay.full ? n : n + 1 }, (_, k) => lay.angles[0] - lay.ang / 2 + k * lay.ang); // between stones, plus the row ends
      const between = lay.full ? gapAngles : gapAngles.slice(1, -1), ends = lay.full ? [] : [gapAngles[0], gapAngles[gapAngles.length - 1]];
      const gw = st.channelW + 0.02, box = new THREE.BoxGeometry(1, 1, 1);
      inst(stoneGeometry(st.shape, st), stoneMat, n, (im) => lay.angles.forEach((th, i) => im.setMatrixAt(i, at(th, lay.rg))), 0, zc);
      const prongCount = gapAngles.length * 2;
      if (st.setting === "channel") {
        setDetail = `walls ${fmt((b.width - st.channelW) / 2, 2)} mm each · gap ${st.st.gap} mm · seat ${fmt(st.channelD + 0.3, 2)} mm deep`;
      } else if (st.setting === "bar") {
        const t = st.st.bar;
        inst(box, this.mats[zc], gapAngles.length, (im) => gapAngles.forEach((th, k) => im.setMatrixAt(k, at(th, mid, 0, 0, t, H, gw))), t * H * gw, zc);
        setDetail = `${gapAngles.length} bars ${t} mm across the band · gap ${st.st.gap} mm each side`;
      } else if (st.setting === "flush") {
        // each stone sunk into the surface, held by a thin burnished rim that stands just proud of the metal
        const inner = offsetPolygon(st.outline, 0.02), outer = offsetPolygon(st.outline, st.st.rim);
        const y0 = surf - 0.22, y1 = surf + 0.07;
        inst(annulusGeometry(outer, inner, y0, y1), this.mats[zc], n, (im) => lay.angles.forEach((th, i) => im.setMatrixAt(i, at(th, 0))), (polyArea(outer) - polyArea(inner)) * 0.1, zc);
        partsVol[zc] -= st.seatVol * n;
        setDetail = `${n} stones sunk flush · rim ${st.st.rim} mm burnished over the girdle · ${st.st.gap} mm between rims`;
      } else if (st.setting === "pave") {
        // bead set: stones in a cut-down row, two raised beads between neighbours (and at the row ends) hold the girdles
        const bead = new THREE.SphereGeometry(st.st.bead, 10, 8), rb = st.st.bead;
        for (const side of [-1, 1]) {
          const z = zoneOfY(sec, -side * st.zp);
          inst(bead, this.mats[z], gapAngles.length, (im) => gapAngles.forEach((th, k) => im.setMatrixAt(k, at(th, surf + rb * 0.45, 0, side * st.zp))), 4 / 3 * Math.PI * rb ** 3 * 0.6, z);
        }
        setDetail = `${gapAngles.length * 2} beads Ø ${fmt(st.st.bead * 2, 2)} mm, bright-cut row · stones ${st.st.gap} mm apart`;
      } else if (st.setting === "shared") {
        // shared prongs rise from saddles between the stones; the scooped gaps are the U cut-outs seen from the side
        const rp = st.rp, tip = lay.rg + 0.3 + rp, sx = st.pitch - st.Lx + 0.1;
        inst(box, this.mats[zc], gapAngles.length, (im) => gapAngles.forEach((th, k) => im.setMatrixAt(k, at(th, mid, 0, 0, sx, H, gw))), sx * H * gw, zc);
        const pg = prongGeometry(rp, surf - 0.25, tip);
        for (const side of [-1, 1]) {
          const z = zoneOfY(sec, -side * st.zp);
          inst(pg.geometry, this.mats[z], gapAngles.length, (im) => gapAngles.forEach((th, k) => im.setMatrixAt(k, at(th, 0, 0, side * st.zp))), pg.volume, z);
        }
        setDetail = `${prongCount} shared prongs Ø ${fmt(st.prong, 2)} mm · tips 0.3 mm over the girdle · U cut-outs between stones`;
      }
      setLimits = `min width ${fmt(Math.ceil(st.minWidth * 10) / 10)} mm · seat ${fmt(st.seat, 2)} mm of ${fmt(b.depth)} mm depth`;
    }
    this.metrics.setting = setDetail; this.metrics.limits = setLimits;
    // Milgrain: a row of tiny beads along the edge, in that edge's metal.
    if (b.profile !== "round" && b.profile !== "custom") for (const side of [-1, 1]) {
      if ((side < 0 ? b.edgel : b.edger) !== "milgrain") continue;
      const hw = b.width / 2, rb = Math.min(0.16, Math.max(0.1, 0.075 * b.depth));
      const y = side * (hw - rb * 0.8), ringR = outerRadius(b, sec.ri, side * hw) - rb * 0.45;
      const n = Math.floor(2 * Math.PI * ringR / (2.15 * rb));
      const z = zoneOfY(sec, y);
      const beads = new THREE.InstancedMesh(new THREE.SphereGeometry(rb, 10, 8), this.mats[z], n);
      for (let k = 0; k < n; k++) { const th = k / n * Math.PI * 2; m.makeTranslation(Math.cos(th) * ringR, y, -Math.sin(th) * ringR); beads.setMatrixAt(k, m); }
      beads.instanceMatrix.needsUpdate = true; beads.castShadow = true;
      this.group.add(beads); this.parts.push(beads);
      partsVol[z] += n * (4 / 3) * Math.PI * rb * rb * rb * 0.5;
    }
    if (b.engraving.trim()) {
      const h = Math.min(b.width * 0.55, 2.2);
      const eng = new THREE.Mesh(new THREE.CylinderGeometry(sec.ri - 0.015, sec.ri - 0.015, h, 128, 1, true), this.engraveMat);
      drawEngraving(this.engraveCanvas, b.engraving.trim(), b.font); this.engraveTex.needsUpdate = true;
      eng.rotation.y = Math.PI; // text centred at the front
      this.group.add(eng); this.parts.push(eng);
    }
    const ro = sec.centerOuter + 0.1;
    this.metrics.outer = ro;
    // stand the ring on the ground plane whatever its size
    this.group.position.y = GROUND_Y + ro * Math.sin(LEAN) + (b.width / 2) * Math.abs(Math.cos(LEAN)) + 0.02;
    this.shadow.position.y = GROUND_Y + 0.02;
    this.shadow.scale.set(ro * 2.6, ro * 2.6 * Math.abs(Math.cos(LEAN)) + b.width * 1.6, 1);

    // metrics — per zone, so a two-tone band reports the metal of each
    // the groove (seat) is already cut out of the lathe volume; the setting metal is added back
    this.metrics.zoneGrams = built.volumes.map((v, z) => (v + partsVol[z]) / 1000 * METALS[b.metals[z]].density);
    this.metrics.grams = this.metrics.zoneGrams.reduce((a, c) => a + c, 0);
    this.metrics.stones = lay ? lay.n : 0;
    const st = sec.stone;
    this.metrics.carats = lay ? lay.n * (st.shape === "round" ? Math.pow(st.s, 3) * SHAPES.round.k : st.Lx * st.W * st.D * SHAPES[st.shape].k) : 0;
    this.metrics.stoneMm = lay ? st.s : 0;
    this.metrics.stoneDims = lay ? dimsText(st.shape, st) : "";
  }
  applyMaterials(b) {
    for (let z = 0; z < 3; z++) {
      const met = METALS[b.metals[z]], fin = FINISHES[b.finishes[z]], mat = this.mats[z];
      setAlloy(mat, b.metals[z]);
      mat.userData.micro.value = fin.micro || 0.03;
      mat.roughness = fin.roughness;
      mat.envMapIntensity = fin.env || 1;
      mat.anisotropy = fin.anisotropy || 0;
      mat.anisotropyRotation = fin.anisoRot != null ? fin.anisoRot : Math.PI / 2;
      if (fin.map) {
        let t = this.maps[z][fin.map];
        if (!t) { t = this.maps[z][fin.map] = finishMap(fin.map).clone(); t.needsUpdate = true; }
        t.repeat.set(this.metrics.circumference / fin.tile, this.metrics.loopLen / fin.tile); // tile = real mm
        mat.normalMap = t; mat.normalScale.set(fin.scale, fin.scale);
        if (fin.map === "satin" || fin.map === "brushed") {
          const rk = fin.map + "Rough"; let r = this.maps[z][rk];
          if (!r) { finishMap(fin.map); r = this.maps[z][rk] = FINISH_MAPS[rk].clone(); r.needsUpdate = true; }
          r.repeat.copy(t.repeat); mat.roughnessMap = r; mat.roughness = 1;
        } else mat.roughnessMap = null;
      } else { mat.normalMap = null; mat.roughnessMap = null; }
      mat.needsUpdate = true;
    }
  }
}
const views = [new BandView(), new BandView()];
views[1].setVisible(false);

function layoutViews() {
  if (!ui.pair) { views[0].setOffset(0); return; }
  views[0].setOffset(-(views[0].metrics.outer + PAIR_GAP / 2));
  views[1].setOffset(views[1].metrics.outer + PAIR_GAP / 2);
}
function fitView() {
  const ros = [views[0].metrics.outer, ui.pair ? views[1].metrics.outer : 0];
  const half = ui.pair ? ros[0] + ros[1] + PAIR_GAP / 2 : ros[0];
  const vf = camera.fov * Math.PI / 180, hf = 2 * Math.atan(Math.tan(vf / 2) * camera.aspect);
  const dist = Math.max(half * 1.45 / Math.tan(hf / 2), Math.max(...ros) * 1.6 / Math.tan(vf / 2)) + 6;
  const dir = camera.position.clone().sub(controls.target).normalize();
  // on a wide stage, sit the ring right of centre so the intro copy has room
  controls.target.set(camera.aspect > 1.25 ? -0.22 * half : 0, -0.8, 0);
  camera.position.copy(controls.target).add(dir.multiplyScalar(dist));
  controls.minDistance = dist * 0.5; controls.maxDistance = dist * 2.2;
}
function resize() {
  const w = viewer.clientWidth, h = viewer.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
new ResizeObserver(() => { resize(); requestAnimationFrame(chipCheck); setTimeout(chipCheck, 150); }).observe(viewer);
window.addEventListener("resize", () => setTimeout(chipCheck, 250));
resize();
renderer.setAnimationLoop(() => { controls.update(); if (!tryon.active) renderer.render(scene, camera); }); // the try-on owns the stage while it's up

// ── UI ───────────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const panel = document.querySelector(".bb-panel");
const fmt = (n, d = 1) => Number(n).toFixed(d).replace(/\.0$/, "");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const optValue = (b, opt) => opt === "metal" ? b.metals[ui.zone] : opt === "finish" ? b.finishes[ui.zone] : b[opt];

function bandText(b, v) {
  const zn = ZONE_NAMES[b.zones];
  const per = (table, arr) => b.zones === 1 ? table[arr[0]].name : zn.map((n, i) => `${n}: ${table[arr[i]].name}`).join(" · ");
  const edges = b.profile === "round" || b.profile === "custom" ? "—" : b.edgel === b.edger ? EDGES[b.edgel] : `${EDGES[b.edgel]} / ${EDGES[b.edger]} (L / R)`;
  const m = v.metrics;
  const weight = `≈ ${fmt(m.grams)} g` + (b.zones > 1 ? ` (${m.zoneGrams.map((g, i) => `${zn[i].toLowerCase()} ${fmt(g)} g`).join(", ")})` : "");
  return {
    profile: b.profile === "custom" ? `Custom section (${CUSTOM ? CUSTOM.name : "imported"})` : `${PROFILES[b.profile].name} · ${b.profile === "round" ? "round interior" : INTERIORS[b.interior]}`,
    edges, width: `${fmt(b.width)} mm`, depth: `${fmt(b.depth)} mm`,
    wave: b.wave > 0 && b.profile !== "custom" ? `${WAVE_MODES[b.wavemode]} · ${fmt(b.wave, 2)} mm × ${b.wavef} around` : "—",
    metal: per(METALS, b.metals), finish: per(FINISHES, b.finishes),
    diamonds: m.stones ? `${m.stones} × ${SHAPES[b.shape].name.toLowerCase()} ${m.stoneDims} · ${SETTINGS[b.setting].name} · ${SPANS[b.stones]} (≈ ${fmt(m.carats, 2)} ct tw)` : "None",
    setting: m.stones ? m.setting : "—",
    limits: m.stones ? m.limits : "—",
    size: `${sizeText(b.size)} · ${fmt(usToDiameter(b.size))} mm inside`,
    engraving: b.engraving.trim() ? `“${b.engraving.trim()}” (${{ script: "script", serif: "serif", sans: "modern" }[b.font]})` : "—",
    estimate: (() => { const e = estimateBand(b, m); return e.totalCents == null ? estimateText(e) : `${estimateText(e)} (metal ${usd(e.metalCents)} + labour ${usd(e.laborCents)})`; })(),
    weight,
  };
}
// Profile icons are the real cross-sections (same functions that cut the band).
function profileIconPath(key) {
  const b = { profile: key, width: 4, depth: 1.8, interior: "comfort" }, ri = 5, N = 40;
  const X = (y) => 10 + (y + 2) / 4 * 44, Y = (r) => 6 + (ri + 1.8 - r) / 1.8 * 24;
  const pts = [];
  for (let i = 0; i <= N; i++) { const y = -2 + 4 * i / N; pts.push(`${X(y).toFixed(1)} ${Y(outerRadius(b, ri, y)).toFixed(1)}`); }
  for (let i = 0; i <= N; i++) { const y = 2 - 4 * i / N; pts.push(`${X(y).toFixed(1)} ${Y(innerRadius(b, ri, y)).toFixed(1)}`); }
  return "M" + pts.join("L") + "Z";
}
document.querySelectorAll('#bbProfiles [data-opt="profile"]:not([data-v="custom"]) svg').forEach((svg) => {
  svg.innerHTML = `<path d="${profileIconPath(svg.parentElement.dataset.v)}"/>`;
});
const setRange = (el, v, label) => {
  const f = (v - el.min) / (el.max - el.min);
  el.value = v; el.style.setProperty("--p", `${f * 100}%`);
  const wrap = el.parentElement; wrap.style.setProperty("--p", `${f * 100}%`); wrap.style.setProperty("--pf", f);
  const out = wrap.querySelector(".bb-bubble"); if (out && label != null) out.textContent = label;
};

const ROW_LABELS = { profile: "Profile", edges: "Edges", width: "Width", depth: "Depth", metal: "Metal", finish: "Finish", wave: "Wave", diamonds: "Diamonds", setting: "Setting", limits: "Fit rules", size: "Size", engraving: "Engraving", weight: "Est. metal weight", estimate: "Price estimate" };

function syncUI() {
  const b = active();
  panel.querySelectorAll("[data-opt]").forEach((el) => {
    const on = optValue(b, el.dataset.opt) === el.dataset.v;
    el.classList.toggle("on", on); el.setAttribute("aria-pressed", on);
  });
  panel.querySelectorAll("[data-ui]").forEach((el) => {
    const cur = ui[el.dataset.ui], v = el.dataset.v;
    const on = typeof cur === "boolean" ? cur === (v === "1") : cur === v;
    el.classList.toggle("on", on); el.setAttribute("aria-pressed", on);
  });
  panel.querySelectorAll("[data-band]").forEach((el) => { const on = Number(el.dataset.band) === ui.active; el.classList.toggle("on", on); el.setAttribute("aria-pressed", on); });
  panel.querySelectorAll("[data-tab]").forEach((el) => { const on = el.dataset.tab === ui.tab; el.classList.toggle("on", on); el.setAttribute("aria-selected", on); });
  panel.querySelectorAll("[data-pane]").forEach((el) => { el.hidden = el.dataset.pane !== ui.tab; });
  $("bbPairRow").hidden = !ui.pair; $("bbPairNote").hidden = !ui.pair;
  $("bbEditing").hidden = !ui.pair; $("bbEditing").textContent = `Editing ${BAND_NAMES[ui.active]}`;

  setRange($("bbWidth"), b.width, fmt(b.width) + " mm"); $("bbWidthV").textContent = fmt(b.width) + " mm";
  setRange($("bbDepth"), b.depth, fmt(b.depth) + " mm"); $("bbDepthV").textContent = fmt(b.depth) + " mm";
  // size: rebuild the list for the chosen system, pick the nearest entry
  const sel = $("bbSize"), opts = sizeOptions(ui.sizesys);
  const key = ui.sizesys + ":" + opts.length;
  if (sel.dataset.key !== key) { sel.innerHTML = opts.map((o) => `<option value="${o.v}">${o.label}</option>`).join(""); sel.dataset.key = key; }
  let best = opts[0]; for (const o of opts) if (Math.abs(o.v - b.size) < Math.abs(best.v - b.size)) best = o;
  sel.value = String(best.v);
  $("bbSizeAll").textContent = sizeText(b.size) + ` · ${fmt(usToDiameter(b.size))} mm inside`;
  $("bbEngrave").value = b.engraving; $("bbFont").value = b.font;
  $("bbEngraveCount").textContent = `${b.engraving.length}/30`;
  // manufacturing rules: disable what can't be set, say why in one line each
  const reasons = [];
  const gate = (el, issue) => { el.disabled = !!issue; el.title = issue || ""; if (issue && !reasons.includes(issue)) reasons.push(issue); };
  panel.querySelectorAll('[data-opt="shape"]').forEach((el) => gate(el, stoneRules(b, el.dataset.v, b.setting, b.stonesz).issue));
  panel.querySelectorAll('[data-opt="setting"]').forEach((el) => gate(el, stoneRules(b, b.shape, el.dataset.v, b.stonesz).issue));
  panel.querySelectorAll('[data-opt="stonesz"]').forEach((el) => gate(el, stoneRules(b, b.shape, b.setting, el.dataset.v).issue));
  $("bbRuleNote").innerHTML = reasons.slice(0, 5).map(esc).join("<br>");
  $("bbRuleNote").hidden = !reasons.length;
  $("bbStoneNote").textContent = b.stoneNote || ""; $("bbStoneNote").hidden = !b.stoneNote;
  const isRound = b.profile === "round";
  panel.querySelectorAll('[data-opt="interior"],[data-opt="edgel"],[data-opt="edger"]').forEach((el) => { el.disabled = isRound || b.profile === "custom"; });
  $("bbRoundNote").hidden = !isRound;
  // zones
  const zn = ZONE_NAMES[b.zones];
  if (ui.zone >= b.zones) ui.zone = 0;
  const seg = $("bbZoneSeg");
  seg.hidden = b.zones === 1;
  seg.innerHTML = zn.map((n, i) => `<button type="button" class="bb-segb${i === ui.zone ? " on" : ""}" data-zone="${i}" aria-pressed="${i === ui.zone}"><span class="sw" style="background:${METALS[b.metals[i]].sw}"></span>${n}</button>`).join("");
  $("bbSplitG").hidden = b.zones !== 2; $("bbMidG").hidden = b.zones !== 3;
  const isCustom = b.profile === "custom";
  setRange($("bbWave"), b.wave, b.wave > 0 ? fmt(b.wave, 2) + " mm" : "Off"); setRange($("bbWaveF"), b.wavef, `${b.wavef} ×`);
  $("bbWaveFG").hidden = !(b.wave > 0); $("bbWaveModeG").hidden = !(b.wave > 0);
  panel.querySelectorAll('[data-opt="wavemode"]').forEach((el) => { el.disabled = isCustom || (el.dataset.v !== "groove" && b.zones !== 2); });
  $("bbWaveNote").textContent = isCustom ? "Waves don't apply to an imported section." : b.zones !== 2 && b.wavemode !== "groove" ? "A wavy split needs exactly two colour zones; the groove still applies." : "";
  $("bbCustomBtn").disabled = !CUSTOM; $("bbCustomBtn").querySelector("small").textContent = CUSTOM ? CUSTOM.name : "Import a section below";
  $("bbWidth").disabled = isCustom; $("bbDepth").disabled = isCustom;
  $("bbCustomNote").hidden = !isCustom;
  setRange($("bbSplit"), Math.round(b.zsplit * 100), `${Math.round(b.zsplit * 100)} / ${100 - Math.round(b.zsplit * 100)}`); $("bbSplitV").textContent = `${Math.round(b.zsplit * 100)} / ${100 - Math.round(b.zsplit * 100)}`;
  setRange($("bbMid"), Math.round(b.zmid * 100), `${Math.round((1 - b.zmid) * 50)} / ${Math.round(b.zmid * 100)} / ${Math.round((1 - b.zmid) * 50)}`); $("bbMidV").textContent = `${Math.round((1 - b.zmid) * 50)} / ${Math.round(b.zmid * 100)} / ${Math.round((1 - b.zmid) * 50)}`;
  $("bbMetalH").textContent = b.zones === 1 ? "Metal" : `Metal · ${zn[ui.zone].toLowerCase()} zone`;
  $("bbFinishH").textContent = b.zones === 1 ? "Finish" : `Finish · ${zn[ui.zone].toLowerCase()} zone`;
  $("bbStoneSizeNote").textContent = sizeNoteText(b);

  // summary
  const list = ui.pair ? [0, 1] : [0];
  $("bbSummary").innerHTML = list.map((i) => {
    const t = bandText(bands[i], views[i]);
    const rows = Object.keys(ROW_LABELS).map((k) => `<div class="bb-row"><span>${ROW_LABELS[k]}</span><b>${esc(t[k])}</b></div>`).join("");
    return (ui.pair ? `<div class="bb-sumh">${BAND_NAMES[i]}</div>` : "") + rows;
  }).join("");
  // action bar
  const b0 = bands[0], m0 = views[0].metrics;
  if (ui.pair) {
    const m1 = views[1].metrics;
    $("bbBarTitle").textContent = `${BAND_NAMES[0]} ${fmt(b0.width)} mm · ${BAND_NAMES[1]} ${fmt(bands[1].width)} mm`;
    $("bbBarSub").textContent = `US ${usLabel(b0.size)} / ${usLabel(bands[1].size)} · ≈ ${fmt(m0.grams + m1.grams)} g together`;
  } else {
    const short = (k) => METALS[k].name.replace(" Gold", "").replace(" 950", "");
    $("bbBarTitle").textContent = `${PROFILES[b0.profile].name} · ${short(b0.metals[0])}${b0.zones > 1 ? " + " + (b0.zones - 1) : ""}`;
    $("bbBarSub").textContent = `${fmt(b0.width)} mm · US ${usLabel(b0.size)} · ≈ ${fmt(m0.grams)} g${m0.stones ? ` · ${m0.stones} diamonds` : ""}`;
  }
  const est = estimateAll();
  $("bbBarEst").textContent = est.totalCents == null ? "Quoted individually by the atelier" : `Est. ${usd(est.totalCents)}${est.stones ? " + diamonds" : ""} · estimate only`;
  $("bbRequestLabel").textContent = ui.pair ? "Request a quote for the pair" : "Request a quote";
  $("bbSumHint").textContent = ui.pair ? "both bands" : `${Object.keys(ROW_LABELS).length} details`;
  const chip = (i) => { const bb = bands[i], m = views[i].metrics; return `${METALS[bb.metals[0]].name}${bb.zones > 1 ? " +" + (bb.zones - 1) : ""} · ${fmt(bb.width)} mm ${PROFILES[bb.profile].name.toLowerCase()} · ≈${fmt(m.grams)} g`; };
  $("bbChip").textContent = ui.pair ? [0, 1].map((i) => `${BAND_NAMES[i]} ${fmt(bands[i].width)} mm · ≈${fmt(views[i].metrics.grams)} g`).join("  ·  ") : chip(0);
  requestAnimationFrame(chipCheck); setTimeout(chipCheck, 120);
}
function sizeNoteText(b) {
  return Object.keys(STONE_SIZES).map((k) => { const r = stoneRules(b, b.shape, b.setting, k); return `${STONE_SIZES[k].name} ${dimsText(b.shape, r)}${r.issue ? " ✕" : ""}`; }).join(" · ") + ` ${SHAPES[b.shape].name.toLowerCase()} at this width`;
}
function syncLink() {
  if (!ui.pair || !ui.link) return;
  const src = bands[ui.active], dst = bands[1 - ui.active];
  for (const k of LINKED) dst[k] = Array.isArray(src[k]) ? [...src[k]] : src[k];
}
function update(geom = true) {
  syncLink();
  for (const bb of bands) coerceStones(bb);
  views[1].setVisible(ui.pair);
  for (const i of ui.pair ? [0, 1] : [0]) {
    if (geom) views[i].build(bands[i]);
    views[i].applyMaterials(bands[i]);
  }
  layoutViews();
  setEnvFamily(familyForMetal(bands[0].metals[0]));
  syncUI();
  writeHash();
  if (tryon.active) { syncTryUI(); scheduleResend(500); }
}

panel.addEventListener("click", (e) => {
  const el = e.target.closest("button");
  if (!el || el.disabled || !panel.contains(el)) return;
  const b = active();
  if (el.dataset.opt) {
    const k = el.dataset.opt, v = el.dataset.v;
    if (k === "metal") b.metals[ui.zone] = v;
    else if (k === "finish") b.finishes[ui.zone] = v;
    else if (k === "zones") b.zones = Number(v);
    else b[k] = v;
    update(k !== "metal" && k !== "finish");
  } else if (el.dataset.ui) {
    const k = el.dataset.ui, v = el.dataset.v;
    if (k === "pair") { ui.pair = v === "1"; if (!ui.pair) ui.active = 0; update(); fitView(); }
    else if (k === "link") { ui.link = v === "1"; update(); }
    else if (k === "sizesys") { ui.sizesys = v; update(false); }
  } else if (el.dataset.band != null) { ui.active = Number(el.dataset.band); update(false); }
  else if (el.dataset.tab) {
    ui.tab = el.dataset.tab; syncUI();
    const sc = $("bbScroll");
    if (getComputedStyle(sc).overflowY === "auto") sc.scrollTo({ top: 0, behavior: "smooth" });
    else panel.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  else if (el.dataset.zone != null) { ui.zone = Number(el.dataset.zone); syncUI(); }
});
$("bbWidth").addEventListener("input", (e) => { active().width = parseFloat(e.target.value); update(); });
$("bbDepth").addEventListener("input", (e) => { active().depth = parseFloat(e.target.value); update(); });
$("bbSplit").addEventListener("input", (e) => { active().zsplit = parseInt(e.target.value, 10) / 100; update(); });
$("bbMid").addEventListener("input", (e) => { active().zmid = parseInt(e.target.value, 10) / 100; update(); });
$("bbWave").addEventListener("input", (e) => { active().wave = Math.round(parseFloat(e.target.value) * 100) / 100; update(); });
$("bbWaveF").addEventListener("input", (e) => { active().wavef = parseInt(e.target.value, 10); update(); });
$("bbSize").addEventListener("change", (e) => { active().size = clampSize(parseFloat(e.target.value)); update(); });
$("bbEngrave").addEventListener("input", (e) => { active().engraving = e.target.value.slice(0, 30); update(); });
$("bbFont").addEventListener("change", (e) => { active().font = e.target.value; update(); });

$("bbReset").addEventListener("click", () => {
  Object.assign(bands[0], defaultBand(0)); Object.assign(bands[1], defaultBand(1));
  Object.assign(ui, { pair: false, link: true, active: 0, zone: 0, sizesys: "us" });
  update(); fitView();
});
$("bbCopy").addEventListener("click", async () => {
  writeHash();
  const btn = $("bbCopy"), old = btn.textContent;
  try { await navigator.clipboard.writeText(location.href); btn.textContent = "Link copied"; }
  catch { prompt("Copy this link:", location.href); }
  setTimeout(() => (btn.textContent = old), 1800);
});
function snapshot() { renderer.render(scene, camera); return renderer.domElement.toDataURL("image/png"); }
$("bbSave").addEventListener("click", () => {
  const a = document.createElement("a");
  a.download = `azoir-wedding-band-${bands[0].metals[0]}-${fmt(bands[0].width)}mm${ui.pair ? "-pair" : ""}.png`;
  a.href = snapshot();
  a.click();
});

// ── Spec sheet (print view) ──────────────────────────────────────────────────
function refCode() {
  let h = 2166136261 >>> 0;
  for (const c of location.hash.slice(1)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  const A = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i++) { out += A[h % A.length]; h = Math.floor(h / A.length); }
  return "AZB-" + out;
}
function sectionSVG(b, v) {
  const sec = v.sec, lay = v.layout;
  const loop = sectionAt(sec, sec.stone && sec.stone.channel ? sec.stone.channelD : 0, TOP).flat();
  const xs = loop.map((p) => p.x), ys = loop.map((p) => p.y);
  let xmin = Math.min(...xs), xmax = Math.max(...xs), ymin = Math.min(...ys), ymax = Math.max(...ys);
  if (lay) xmax = Math.max(xmax, lay.rg + sec.stone.hc + 0.1);
  const S = Math.min(48, 220 / (ymax - ymin)), pad = 34;
  const X = (y) => pad + (y - ymin) * S, Y = (x) => pad + (xmax - x) * S;
  const W = X(ymax) + pad + 30, H = Y(xmin) + pad + 10;
  const zonePolys = b.zones === 1 ? [loop] : Array.from({ length: b.zones }, (_, z) =>
    clipY(loop, z === 0 ? -1e9 : sec.zoneBounds[z - 1], z === b.zones - 1 ? 1e9 : sec.zoneBounds[z]));
  const path = (pts) => "M" + pts.map((p) => `${X(p.y).toFixed(1)} ${Y(p.x).toFixed(1)}`).join("L") + "Z";
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="DM Sans,system-ui,sans-serif" font-size="10" fill="#0f172a">`;
  zonePolys.forEach((pts, z) => { s += `<path d="${path(pts)}" fill="${METALS[b.metals[z]].sw}" stroke="#0f172a" stroke-width="1" stroke-linejoin="round"/>`; });
  if (lay) {
    const st = sec.stone, hw2 = st.W / 2, tw = hw2 * 0.6, P = (y, x) => `${X(y).toFixed(1)} ${Y(x).toFixed(1)}`;
    const keel = st.shape === "emerald" || st.shape === "baguette" ? 0.25 * st.W : 0;
    const d = `M${P(-hw2, lay.rg)} L${P(hw2, lay.rg)} L${P(tw, lay.rg + st.hc)} L${P(-tw, lay.rg + st.hc)} Z M${P(-hw2, lay.rg)} L${P(-keel, lay.rg - st.hp)} L${P(keel, lay.rg - st.hp)} L${P(hw2, lay.rg)}`;
    s += `<path d="${d}" fill="rgba(255,255,255,.7)" stroke="#0f172a" stroke-width=".8" stroke-dasharray="2 2"/>`;
    s += `<text x="${X(0)}" y="${Y(lay.rg + st.hc) - 4}" text-anchor="middle" font-size="9">${esc(dimsText(st.shape, st))}</text>`;
  }
  // width dimension (below)
  const dy = Y(xmin) + 16;
  s += `<line x1="${X(ymin)}" y1="${dy}" x2="${X(ymax)}" y2="${dy}" stroke="#64748b" stroke-width=".8"/>`;
  s += `<line x1="${X(ymin)}" y1="${dy - 5}" x2="${X(ymin)}" y2="${dy + 5}" stroke="#64748b" stroke-width=".8"/><line x1="${X(ymax)}" y1="${dy - 5}" x2="${X(ymax)}" y2="${dy + 5}" stroke="#64748b" stroke-width=".8"/>`;
  s += `<text x="${(X(ymin) + X(ymax)) / 2}" y="${dy + 13}" text-anchor="middle">${fmt(b.width)} mm wide</text>`;
  // depth dimension (right)
  const dx = X(ymax) + 16, top = Y(sec.centerOuter), bot = Y(sec.ri);
  s += `<line x1="${dx}" y1="${top}" x2="${dx}" y2="${bot}" stroke="#64748b" stroke-width=".8"/>`;
  s += `<line x1="${dx - 5}" y1="${top}" x2="${dx + 5}" y2="${top}" stroke="#64748b" stroke-width=".8"/><line x1="${dx - 5}" y1="${bot}" x2="${dx + 5}" y2="${bot}" stroke="#64748b" stroke-width=".8"/>`;
  s += `<text x="${dx + 8}" y="${(top + bot) / 2 + 3}" font-size="9">${fmt(b.depth)} mm</text>`;
  s += `<text x="${X(ymin)}" y="${pad - 14}" font-size="9" fill="#64748b">L</text><text x="${X(ymax)}" y="${pad - 14}" font-size="9" fill="#64748b" text-anchor="end">R</text>`;
  s += `<text x="${pad}" y="${H - 4}" font-size="9" fill="#64748b">Cross-section · inside Ø ${fmt(usToDiameter(b.size))} mm</text>`;
  return s + "</svg>";
}
let sheet = null;
function openSheet() {
  if (!sheet) {
    sheet = document.createElement("div"); sheet.className = "bb-sheet"; sheet.setAttribute("role", "dialog"); sheet.setAttribute("aria-label", "Specification sheet");
    document.body.appendChild(sheet);
    sheet.addEventListener("click", (e) => {
      if (e.target.closest("[data-print]")) window.print();
      else if (e.target.closest("[data-json]")) downloadSpec();
      else if (e.target.closest("[data-close]")) sheet.classList.remove("open");
    });
  }
  writeHash();
  const code = refCode();
  const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const list = ui.pair ? [0, 1] : [0];
  const bandBlock = (i) => {
    const b = bands[i], v = views[i], t = bandText(b, v);
    const rows = Object.keys(ROW_LABELS).map((k) => `<tr><td>${ROW_LABELS[k]}</td><td>${esc(t[k])}</td></tr>`).join("");
    return `<section class="bb-doc-band">
      <h2>${ui.pair ? BAND_NAMES[i] + " — " : ""}${esc(PROFILES[b.profile].name)} band, ${fmt(b.width)} mm</h2>
      <div class="bb-doc-sec">${sectionSVG(b, v)}</div>
      <table>${rows}</table>
    </section>`;
  };
  sheet.innerHTML = `
    <div class="bb-sheet-bar"><button type="button" class="btn-outline sm" data-close>Close</button><button type="button" class="btn-outline sm" data-json>Download spec (JSON)</button><button type="button" class="btn-fill sm" data-print>Print / save PDF</button></div>
    <div class="bb-doc">
      <div class="bb-doc-head">
        <div><img src="media/azoir-logo.png" alt="AZOIR &amp; Co."><div class="bb-doc-sub">Wedding band specification${ui.pair ? " · His &amp; Hers pair" + (ui.link ? " (linked)" : "") : ""}</div></div>
        <div class="bb-doc-meta"><b>${code}</b>${date}<br>azoir.co · New York</div>
      </div>
      <img class="bb-doc-snap" src="${snapshot()}" alt="3D preview">
      ${list.map(bandBlock).join("")}
      <div class="bb-doc-foot">Reference ${code}. Dimensions in millimetres; weights are estimates from the 3D model and are confirmed by the atelier before casting. Prices are estimates only — metal by weight at the atelier's current rate plus labour per band; diamonds, and any metal without a set rate, are quoted individually — and are confirmed by the atelier before anything is made. Ring sizes: US chart, EU (ISO circumference) and UK letters. Every design is quoted individually — share this sheet or the link below with hello@azoir.co.<br><span class="bb-doc-link">${esc(location.href)}</span></div>
    </div>`;
  sheet.classList.add("open");
  sheet.scrollTop = 0;
}
$("bbSheetBtn").addEventListener("click", openSheet);

// The spec as the atelier reads it — this text goes into the commission request.
function specText() {
  const list = ui.pair ? [0, 1] : [0];
  const blocks = list.map((i) => {
    const b = bands[i], t = bandText(b, views[i]);
    return [
      ui.pair ? `— ${BAND_NAMES[i]} —` : "",
      `Profile: ${t.profile} · edges: ${t.edges}`,
      `Width ${t.width} · depth ${t.depth} · size ${t.size}`,
      `Metal: ${t.metal} · finish: ${t.finish}`,
      t.wave !== "—" ? `Wave: ${t.wave}` : "",
      `Diamonds: ${t.diamonds}`,
      t.setting !== "—" ? `Setting: ${t.setting}` : "",
      t.limits !== "—" ? `Fit rules: ${t.limits}` : "",
      b.engraving.trim() ? `Engraving: "${b.engraving.trim()}"` : "",
      `Estimated weight ${t.weight}`,
      `Price estimate: ${t.estimate}`,
    ].filter(Boolean).join("\n");
  });
  const est = estimateAll();
  return [
    `Wedding band${ui.pair ? "s (His & Hers pair" + (ui.link ? ", linked)" : ")") : ""} — ref ${refCode()}\n${location.href}`,
    ...blocks,
    `Estimate for the ${ui.pair ? "pair" : "band"}: ${estimateText(est)}. Metal by weight (14k $120/g, 18k by gold content) plus $100 labour per band; diamonds quoted separately. This is an estimate, not a quote — the atelier confirms the price before anything is made.`,
  ].join("\n\n");
}

// Hand the design to the commission wizard (same localStorage it reads), which
// sends the brief to the atelier. No prices anywhere: the site is inquiry-only.
function requestQuote() {
  writeHash();
  const list = ui.pair ? [0, 1] : [0];
  const anyStones = list.some((i) => views[i].metrics.stones);
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem("azoir_wiz") || "{}"); } catch {}
  saved.type = "Wedding bands";
  saved.metal = METALS[bands[0].metals[0]].wizard;
  if (anyStones && !saved.stone) saved.stone = "";
  else if (!anyStones) saved.stone = "No stone";
  const own = (saved.message || "").split("\n\n--- your notes ---\n")[1] || (saved.message && !/from the builder|— ref AZB-/.test(saved.message) ? saved.message : "");
  saved.message = specText() + "\n\n--- spec.json ---\n" + JSON.stringify(specJSON()) + (own ? "\n\n--- your notes ---\n" + own : "");
  saved.step = 2;
  try { localStorage.setItem("azoir_wiz", JSON.stringify(saved)); } catch {}
  location.href = "commission.html?from=band-builder";
}

$("bbRequest").addEventListener("click", requestQuote);

// ── Custom cross-section import (SVG path, DXF polyline, Rhino .3dm) ─────────
// The file describes the section in mm: y along the band axis, x radial. We
// resample it, check it is closed, simple and never thinner than 0.8 mm, then
// use it as the whole profile (stones, edges and interior options switch off).
let CUSTOM = null;
try { CUSTOM = JSON.parse(localStorage.getItem("azoir_band_profile") || "null"); } catch {}
function parseSvgPath(d) {
  const tok = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) || [];
  const pts = []; let cmd = "", i = 0, cx = 0, cy = 0, sx = 0, sy = 0, px = 0, py = 0;
  const num = () => parseFloat(tok[i++]);
  const bez = (x1, y1, x2, y2, x3, y3) => { for (let k = 1; k <= 8; k++) { const t = k / 8, u = 1 - t;
    pts.push([u * u * u * cx + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, u * u * u * cy + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3]); } px = x2; py = y2; cx = x3; cy = y3; };
  const quad = (x1, y1, x2, y2) => { for (let k = 1; k <= 8; k++) { const t = k / 8, u = 1 - t; pts.push([u * u * cx + 2 * u * t * x1 + t * t * x2, u * u * cy + 2 * u * t * y1 + t * t * y2]); } px = x1; py = y1; cx = x2; cy = y2; };
  while (i < tok.length) {
    if (/[a-zA-Z]/.test(tok[i])) cmd = tok[i++];
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
    const ox = rel ? cx : 0, oy = rel ? cy : 0;
    if (C === "M") { cx = ox + num(); cy = oy + num(); sx = cx; sy = cy; pts.push([cx, cy]); cmd = rel ? "l" : "L"; }
    else if (C === "L") { cx = ox + num(); cy = oy + num(); pts.push([cx, cy]); }
    else if (C === "H") { cx = ox + num(); pts.push([cx, cy]); }
    else if (C === "V") { cy = oy + num(); pts.push([cx, cy]); }
    else if (C === "C") { const x1 = ox + num(), y1 = oy + num(), x2 = ox + num(), y2 = oy + num(), x3 = ox + num(), y3 = oy + num(); bez(x1, y1, x2, y2, x3, y3); }
    else if (C === "S") { const x2 = ox + num(), y2 = oy + num(), x3 = ox + num(), y3 = oy + num(); bez(2 * cx - px, 2 * cy - py, x2, y2, x3, y3); }
    else if (C === "Q") { const x1 = ox + num(), y1 = oy + num(), x2 = ox + num(), y2 = oy + num(); quad(x1, y1, x2, y2); }
    else if (C === "T") { const x2 = ox + num(), y2 = oy + num(); quad(2 * cx - px, 2 * cy - py, x2, y2); }
    else if (C === "Z") { cx = sx; cy = sy; break; }
    else if (C === "A") { i += 5; cx = ox + num(); cy = oy + num(); pts.push([cx, cy]); } // arcs: chord only
    else throw new Error("unsupported path command " + cmd);
  }
  return pts;
}
function parseDxf(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  let i = 0, pts = [], inPoly = false, best = null;
  const flush = () => { if (pts.length >= 3 && (!best || pts.length > best.length)) best = pts; pts = []; };
  while (i < lines.length - 1) {
    const code = lines[i], val = lines[i + 1]; i += 2;
    if (code === "0") { if (inPoly) { flush(); inPoly = false; } if (val === "LWPOLYLINE" || val === "POLYLINE") inPoly = true; continue; }
    if (!inPoly) continue;
    if (code === "10") { const x = parseFloat(val); const y = lines[i] === "20" ? parseFloat(lines[i + 1]) : 0; pts.push([x, y]); }
  }
  if (inPoly) flush();
  if (!best) throw new Error("no polyline found in the DXF");
  return best;
}
async function parse3dm(buf) {
  if (!window.rhino3dm) await new Promise((res, rej) => { const sc = document.createElement("script"); sc.src = "https://cdn.jsdelivr.net/npm/rhino3dm@8.4.0/rhino3dm.min.js"; sc.onload = res; sc.onerror = () => rej(new Error("could not load the 3dm reader")); document.head.appendChild(sc); });
  const rhino = await window.rhino3dm();
  const doc = rhino.File3dm.fromByteArray(new Uint8Array(buf));
  if (!doc) throw new Error("not a readable .3dm file");
  const objs = doc.objects();
  for (let k = 0; k < objs.count; k++) {
    const g = objs.get(k).geometry();
    if (!g || g.objectType !== rhino.ObjectType.Curve || !g.isClosed) continue;
    const pl = g.tryGetPolyline ? g.tryGetPolyline() : null;
    const pts = [];
    if (pl && pl.count) { for (let j = 0; j < pl.count; j++) { const q = pl.get(j); pts.push([q[0], q[1]]); } }
    else { const [t0, t1] = g.domain; for (let j = 0; j < 160; j++) { const q = g.pointAt(t0 + (t1 - t0) * j / 160); pts.push([q[0], q[1]]); } }
    return pts;
  }
  throw new Error("no closed curve found in the .3dm");
}
function segIntersect(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b) && o(a, b, c) !== 0 && o(c, d, a) !== 0;
}
// Validate + normalise: returns {pts:[{x,y}], width, depth} or throws with the reason.
function prepareCustom(raw, name) {
  let pts = raw.filter((p, i) => i === 0 || Math.hypot(p[0] - raw[i - 1][0], p[1] - raw[i - 1][1]) > 1e-4);
  if (pts.length < 3) throw new Error("fewer than three points");
  if (Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-4) pts.pop();
  // x radial, y along the axis: centre y, put the inside of the ring at x = 0
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const xmin = Math.min(...xs), xmax = Math.max(...xs), ymin = Math.min(...ys), ymax = Math.max(...ys);
  const width = ymax - ymin, depth = xmax - xmin;
  if (width < 1.5 || width > 12) throw new Error(`section is ${fmt(width)} mm wide along the axis; expected 1.5–12 mm (units must be mm)`);
  if (depth < 0.8 || depth > 5) throw new Error(`section is ${fmt(depth)} mm deep; expected 0.8–5 mm (units must be mm)`);
  pts = pts.map((p) => [p[0] - xmin, p[1] - (ymin + ymax) / 2]);
  // resample long edges so the sweep is smooth
  const out = [];
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]), k = Math.max(1, Math.ceil(l / 0.12)); for (let j = 0; j < k; j++) out.push([a[0] + (b[0] - a[0]) * j / k, a[1] + (b[1] - a[1]) * j / k]); }
  if (out.length > 600) throw new Error("section is too detailed (over 600 points after resampling)");
  // simple polygon?
  for (let i = 0; i < out.length; i++) for (let j = i + 2; j < out.length; j++) {
    if (i === 0 && j === out.length - 1) continue;
    if (segIntersect(out[i], out[(i + 1) % out.length], out[j], out[(j + 1) % out.length])) throw new Error("the outline crosses itself");
  }
  // winding: outer surface traversed with y rising (positive signed area in x,y)
  let A = 0; for (let i = 0; i < out.length; i++) { const a = out[i], b = out[(i + 1) % out.length]; A += a[0] * b[1] - b[0] * a[1]; }
  if (A < 0) out.reverse();
  // wall thickness: scan horizontal lines, every solid span must be ≥ 0.8 mm
  for (let k = 1; k < 24; k++) {
    const y = -width / 2 + width * k / 24, hits = [];
    for (let i = 0; i < out.length; i++) { const a = out[i], b = out[(i + 1) % out.length]; if ((a[1] <= y) !== (b[1] <= y)) hits.push(a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1])); }
    hits.sort((p, q) => p - q);
    for (let i = 0; i + 1 < hits.length; i += 2) if (hits[i + 1] - hits[i] < 0.8 - 1e-6) throw new Error(`wall is only ${fmt(hits[i + 1] - hits[i], 2)} mm at ${fmt(y)} mm across — minimum 0.8 mm`);
  }
  return { name, pts: out.map(([x, y]) => ({ x, y })), width: Math.round(width * 10) / 10, depth: Math.round(depth * 10) / 10 };
}
async function importProfile(file) {
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  let raw;
  if (ext === "svg") { const t = await file.text(); const m = t.match(/\sd="([^"]+)"/) || t.match(/\sd='([^']+)'/); if (!m) throw new Error("no <path d> in the SVG"); raw = parseSvgPath(m[1]); }
  else if (ext === "dxf") raw = parseDxf(await file.text());
  else if (ext === "3dm") raw = await parse3dm(await file.arrayBuffer());
  else throw new Error("use an .svg, .dxf or .3dm file");
  const c = prepareCustom(raw, file.name);
  CUSTOM = c;
  try { localStorage.setItem("azoir_band_profile", JSON.stringify(c)); } catch {}
  const b = active();
  b.profile = "custom"; b.width = c.width; b.depth = c.depth; b.stones = "none"; b.wave = 0;
  update(); fitView();
}
$("bbProfileFile").addEventListener("change", async (e) => {
  const f = e.target.files && e.target.files[0]; if (!f) return;
  const note = $("bbImportNote"); note.hidden = false; note.textContent = "Reading " + f.name + "…";
  try { await importProfile(f); note.textContent = `Imported ${f.name}: ${fmt(CUSTOM.width)} × ${fmt(CUSTOM.depth)} mm, ${CUSTOM.pts.length} points.`; }
  catch (err) { note.textContent = "Not usable: " + err.message + "."; }
  e.target.value = "";
});

// ── Spec JSON ────────────────────────────────────────────────────────────────
function specJSON() {
  const list = ui.pair ? [0, 1] : [0];
  const r2 = (v) => Math.round(v * 100) / 100;
  return {
    version: 2, ref: refCode(), url: location.href, createdAt: new Date().toISOString(), pair: ui.pair, linked: ui.pair ? ui.link : undefined,
    estimate: (() => { const e = estimateAll(); return { isEstimate: true, note: "estimate only, confirmed by the atelier; diamonds quoted separately", totalCents: e.totalCents, metalCents: e.metalCents, laborCents: e.laborCents, unpricedMetals: e.unpriced, perGramCents: PRICING.perGramCents, laborCentsPerBand: PRICING.laborCents }; })(),
    bands: list.map((i) => {
      const b = bands[i], v = views[i], m = v.metrics, st = v.sec && v.sec.stone, zb = [-b.width / 2, ...zoneBoundsOf(b), b.width / 2];
      return {
        label: ui.pair ? BAND_NAMES[i] : "Band",
        profile: { key: b.profile, name: PROFILES[b.profile].name, interior: b.profile === "round" ? "round" : b.interior, edges: { left: b.edgel, right: b.edger } },
        widthMm: b.width, depthMm: b.depth,
        size: { us: b.size, eu: Math.round(usToEU(b.size)), uk: usToUK(b.size), innerDiameterMm: r2(usToDiameter(b.size)), circumferenceMm: r2(usToEU(b.size)) },
        zones: Array.from({ length: b.zones }, (_, z) => ({ fromMm: r2(zb[z]), toMm: r2(zb[z + 1]), metal: b.metals[z], metalName: METALS[b.metals[z]].name, densityGcm3: METALS[b.metals[z]].density, finish: b.finishes[z], finishName: FINISHES[b.finishes[z]].name, weightG: r2(m.zoneGrams[z]) })),
        wave: b.wave > 0 ? { amplitudeMm: b.wave, frequency: b.wavef, mode: b.wavemode } : null,
        stones: m.stones ? { count: m.stones, shape: b.shape, shapeName: SHAPES[b.shape].name, span: b.stones, sizeKey: b.stonesz, shortMm: r2(st.s), acrossBandMm: r2(st.W), alongBandMm: r2(st.Lx), depthMm: r2(st.D), caratsTotal: r2(m.carats), setting: b.setting, settingName: SETTINGS[b.setting].name, detail: m.setting, fitRules: m.limits, grooveWidthMm: r2(st.channelW), grooveDepthMm: r2(st.channelD) } : null,
        engraving: b.engraving.trim() ? { text: b.engraving.trim(), style: b.font } : null,
        weightG: r2(m.grams),
        customProfile: b.profile === "custom" && CUSTOM ? { name: CUSTOM.name, points: CUSTOM.pts.map((p) => [r2(p.x), r2(p.y)]) } : undefined,
      };
    }),
  };
}
function downloadSpec() {
  writeHash();
  const blob = new Blob([JSON.stringify(specJSON(), null, 2)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `azoir-band-${refCode()}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ── Try it on: export the band as GLB (mm, axis +Y, centred) and hand it to the try-on page ──
// ── Try it on: the try-on app runs inside the stage, fed live with the current band ──
// Contract (host mode): iframe ← tryon:set {config:{type,metal,model,innerDiameterMm,fit}}, tryon:cmd {action:'stop'|'snapshot'};
// iframe → tryon:ready, tryon:change {live, tracking, modelLoaded}, tryon:photo {dataUrl}|{error}.
const PAGE_Q = new URLSearchParams(location.search);
const TRYON_ORIGIN = (() => { const o = PAGE_Q.get("tryon"); return o && /^https?:\/\/[^/]+$/.test(o) ? o : "https://jewel-tryon.pages.dev"; })();
const tryon = { active: false, ready: false, pending: null, timer: 0, wait: 0, photoWaiters: [] };
const stage = document.querySelector(".bb-stage"), tryFrame = $("bbTryFrame"), tryPill = $("bbTryPill");
const isPhone = () => matchMedia("(max-width:900px)").matches;
function tryonSrc() {
  let u = `${TRYON_ORIGIN}/?type=ring&embed=1&ui=host&theme=light&host=${encodeURIComponent(location.origin)}&brand=${encodeURIComponent("Azoir & Co.")}`;
  const photo = PAGE_Q.get("photo"); if (photo) u += `&photo=${encodeURIComponent(photo)}`; // dev: a still instead of the camera
  return u;
}
async function exportGLB(view) {
  const { GLTFExporter } = await import("three/addons/exporters/GLTFExporter.js");
  // Metal keeps its alloy colour and finish roughness (the try-on reads them per part, so two-tone survives);
  // every stone goes out as its own mesh in its own frame, which the try-on's gem shader needs to trace the cut.
  const plain = (mat) => mat === stoneMat
    ? new THREE.MeshPhysicalMaterial({ name: "diamond", color: 0xffffff, metalness: 0, roughness: 0, ior: 2.42, transmission: 0.3, thickness: 0.5 })
    : new THREE.MeshStandardMaterial({ name: "metal", color: mat.color.clone(), metalness: 1, roughness: Math.max(0.03, mat.roughness === 1 ? 0.3 : mat.roughness) });
  const g = new THREE.Group();
  for (const p of view.parts) {
    if (p.material === view.engraveMat) continue;
    if (p.isInstancedMesh && p.material === stoneMat) {
      const m = new THREE.Matrix4();
      for (let i = 0; i < p.count; i++) {
        const stone = new THREE.Mesh(p.geometry, plain(stoneMat)); stone.name = `diamond_${i + 1}`;
        p.getMatrixAt(i, m); m.decompose(stone.position, stone.quaternion, stone.scale);
        g.add(stone);
      }
    } else if (p.isInstancedMesh) {
      const geos = [], m = new THREE.Matrix4();
      for (let i = 0; i < p.count; i++) { const gg = p.geometry.clone(); p.getMatrixAt(i, m); gg.applyMatrix4(m); geos.push(gg); }
      const mesh = new THREE.Mesh(mergeGeometries(geos, false), plain(p.material)); mesh.name = "setting"; g.add(mesh);
    } else { const mesh = new THREE.Mesh(p.geometry, Array.isArray(p.material) ? p.material.map(plain) : plain(p.material)); mesh.name = "band"; g.add(mesh); }
  }
  return new Promise((res, rej) => new GLTFExporter().parse(g, res, rej, { binary: true }));
}
function tryonConfig(model) {
  const b = bands[ui.active];
  const metal = { "14y": "yellow", "18y": "yellow", "14w": "white", "18w": "white", "14r": "rose", "18r": "rose", pt: "platinum" }[b.metals[0]] || "yellow";
  return { type: "tryon:set", config: { type: "ring", metal, model, units: "mm", innerDiameterMm: Math.round(usToDiameter(b.size) * 100) / 100, fit: 1 } };
}
function pill(text) { tryPill.textContent = text || ""; tryPill.hidden = !text; }
function postCmd(action) { if (tryon.ready && tryFrame.contentWindow) tryFrame.contentWindow.postMessage({ type: "tryon:cmd", action }, TRYON_ORIGIN); }
function postPending() {
  if (!tryon.ready || !tryon.pending || !tryon.active) return;
  const model = tryon.pending; tryon.pending = null;
  tryFrame.contentWindow.postMessage(tryonConfig(model), TRYON_ORIGIN, [model]);
  clearTimeout(tryon.wait);
  tryon.wait = setTimeout(() => { if (tryon.active) pill("Still loading… allow the camera if asked, or check your connection."); }, 8000);
}
// Any rebuild while trying on re-exports the band (debounced) and sends it across.
function scheduleResend(delay = 500) {
  clearTimeout(tryon.timer);
  tryon.timer = setTimeout(async () => {
    if (!tryon.active) return;
    pill("Updating your band…");
    try { tryon.pending = await exportGLB(views[ui.active]); postPending(); }
    catch (err) { pill("Couldn't export the band: " + err.message); }
  }, delay);
}
window.addEventListener("message", (e) => {
  if (e.origin !== TRYON_ORIGIN || !e.data || typeof e.data.type !== "string") return;
  const d = e.data;
  if (d.type === "tryon:ready") { tryon.ready = true; postPending(); }
  else if (d.type === "tryon:change") {
    if (d.modelLoaded) { clearTimeout(tryon.wait); pill(d.tracking === "lost" ? "Show the back of your hand to the camera" : ""); }
    else if (d.live === false && !tryon.pending && !tryon.wait) pill("Allow the camera to try it on");
  } else if (d.type === "tryon:photo") tryon.photoWaiters.splice(0).forEach((fn) => fn(d));
});
function syncTryUI() {
  stage.classList.toggle("tryon", tryon.active);
  document.querySelector(".bb-app").classList.toggle("tryon-full", tryon.active && isPhone());
  document.body.classList.toggle("tryon-lock", tryon.active && isPhone());
  document.querySelectorAll("[data-view]").forEach((el) => { const on = (el.dataset.view === "try") === tryon.active; el.classList.toggle("on", on); el.setAttribute("aria-pressed", on); });
  document.querySelectorAll(".bb-trybar [data-band]").forEach((el) => el.classList.toggle("on", Number(el.dataset.band) === ui.active));
  $("bbTryBands").hidden = !ui.pair;
  $("bbTryQr").hidden = true;
}
function enterTryon() {
  if (tryon.active) return;
  tryon.active = true;
  if (!tryFrame.src) { tryon.ready = false; tryFrame.hidden = false; tryFrame.src = tryonSrc(); }
  syncTryUI();
  pill("Preparing your band…");
  scheduleResend(0);
}
function leaveTryon() {
  if (!tryon.active) return;
  tryon.active = false; clearTimeout(tryon.timer); clearTimeout(tryon.wait); tryon.pending = null;
  postCmd("stop"); // camera off; the iframe stays loaded for next time
  pill("");
  syncTryUI();
}
async function savePhoto() {
  const reply = await new Promise((res) => { const t = setTimeout(() => res(null), 4000); tryon.photoWaiters.push((d) => { clearTimeout(t); res(d); }); postCmd("snapshot"); });
  const a = document.createElement("a");
  if (reply && reply.dataUrl) { a.download = "azoir-band-on-hand.png"; a.href = reply.dataUrl; }
  else {
    pill(reply && reply.error === "not-live" ? "The camera isn't live yet — saved the 3D view instead." : "No photo came back — saved the 3D view instead.");
    setTimeout(() => { if (tryon.active) pill(""); }, 2800);
    a.download = `azoir-wedding-band-${bands[0].metals[0]}-${fmt(bands[0].width)}mm.png`; a.href = snapshot();
  }
  a.click();
}
async function showQr() {
  writeHash();
  const wrap = $("bbTryQr"), box = $("bbQr"); wrap.hidden = false; box.textContent = "";
  if (!window.qrcode) await new Promise((res, rej) => { const sc = document.createElement("script"); sc.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js"; sc.onload = res; sc.onerror = () => rej(new Error("QR library failed to load")); document.head.appendChild(sc); }).catch((e) => { box.textContent = e.message; });
  if (!window.qrcode) return;
  const url = location.href + (location.hash.length > 1 ? "&" : "#") + "tryon=1"; // opens straight into try-on on the phone
  const qr = window.qrcode(0, "M"); qr.addData(url); qr.make();
  box.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}
document.querySelectorAll("[data-view]").forEach((el) => el.addEventListener("click", () => (el.dataset.view === "try" ? enterTryon() : leaveTryon())));
for (const id of ["bbTryBack", "bbTryBackBar", "bbTryCloseBar"]) $(id).addEventListener("click", leaveTryon);
$("bbTryPhoto").addEventListener("click", savePhoto);
for (const id of ["bbQrBtn", "bbQrBtnBar"]) $(id).addEventListener("click", showQr);
$("bbQrClose").addEventListener("click", () => { $("bbTryQr").hidden = true; });
document.querySelectorAll(".bb-trybar [data-band]").forEach((el) => el.addEventListener("click", () => { ui.active = Number(el.dataset.band); update(false); }));
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && tryon.active) leaveTryon(); });
matchMedia("(max-width:900px)").addEventListener("change", () => { if (tryon.active) syncTryUI(); });

// ── Chip vs toolbar: hide the chip when they would overlap ───────────────────
function chipCheck() {
  const chip = $("bbChip"), tools = document.querySelector(".bb-tools");
  if (!chip || !tools) return;
  chip.classList.remove("bb-chip-hide");
  const c = chip.getBoundingClientRect(), t = tools.getBoundingClientRect();
  const overlap = c.right > t.left - 8 && c.left < t.right + 8 && c.bottom > t.top - 6 && c.top < t.bottom + 6;
  chip.classList.toggle("bb-chip-hide", overlap);
}

// ── Catalogue: the atelier's option tables, loaded over the baked-in defaults ──
function applyCatalog(c) {
  const merge = (table, src) => { if (!src) return; for (const k of Object.keys(src)) table[k] = Object.assign(table[k] || {}, src[k]); };
  merge(PROFILES, c.profiles); merge(METALS, c.metals); merge(FINISHES, c.finishes); merge(SETTINGS, c.settings); merge(SHAPES, c.shapes); merge(STONE_SIZES, c.stoneSizes);
  if (c.edges) Object.assign(EDGES, c.edges);
  if (c.sizes && c.sizes.usToDiameter) { SIZE_A = c.sizes.usToDiameter.a; SIZE_B = c.sizes.usToDiameter.b; }
  if (c.defaults) DEFAULTS = c.defaults;
  if (c.pricing) PRICING = { laborCents: c.pricing.laborCents ?? PRICING.laborCents, perGramCents: { ...PRICING.perGramCents, ...(c.pricing.perGramCents || {}) } };
  const hide = (opt, keys, table) => { for (const k of keys || []) { delete table[k]; panel.querySelectorAll(`[data-opt="${opt}"][data-v="${k}"]`).forEach((el) => el.remove()); } };
  if (c.hidden) { hide("profile", c.hidden.profiles, PROFILES); hide("metal", c.hidden.metals, METALS); hide("finish", c.hidden.finishes, FINISHES); hide("setting", c.hidden.settings, SETTINGS); hide("shape", c.hidden.shapes, SHAPES); }
  // swatches/names from the catalogue
  panel.querySelectorAll('[data-opt="metal"]').forEach((el) => { const met = METALS[el.dataset.v]; if (!met) return; const sw = el.querySelector(".sw"); if (sw && met.sw) sw.style.background = met.sw; });
}
async function loadCatalog() {
  try {
    const r = await fetch("band-catalog.json", { cache: "no-cache" });
    if (!r.ok) throw new Error(r.status);
    applyCatalog(await r.json());
  } catch (e) { /* baked-in tables stay in force */ }
}

loadCatalog().then(() => {
  Object.assign(bands[0], defaultBand(0)); Object.assign(bands[1], defaultBand(1)); // catalogue defaults
  readHash();
  update();
  fitView();
  if (ui.tryonStart) enterTryon();
  document.fonts?.ready.then(() => { if (bands.some((b) => b.engraving.trim())) update(); });
  window.__bandBuilder = { bands, ui, views, state: bands[0], metrics: views[0].metrics, scene, renderer, camera, rebuild: update, fitView, openSheet, specJSON, exportGLB, importProfile, prepareCustom, CUSTOM: () => CUSTOM, tryon, enterTryon, leaveTryon, TRYON_ORIGIN };
});
