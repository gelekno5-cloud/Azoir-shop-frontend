/* Azoir & Co. — wedding band builder.
   Procedural 3D band (three.js): a cross-section profile is swept around the
   ring axis, so every option (profile, width, depth, size, channel-set stones)
   is real geometry and the weight estimate comes from the rendered volume. */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// ── Catalogue ────────────────────────────────────────────────────────────────
const PROFILES = {
  court:  { name: "Court",       desc: "Softly domed, the classic comfort band" },
  flat:   { name: "Flat",        desc: "Clean, modern, square edges" },
  dshape: { name: "D-shape",     desc: "Half-round, traditional" },
  knife:  { name: "Knife edge",  desc: "A crisp ridge down the centre" },
  bevel:  { name: "Bevelled",    desc: "Flat top, chamfered edges" },
};
const INTERIORS = { comfort: "Comfort fit", flat: "Flat" };
// Base colour = sRGB of the metal's reflectance; density in g/cm³.
const METALS = {
  "14y": { name: "14k Yellow Gold", wizard: "Yellow gold", color: "#F3C66A", density: 13.1, sw: "#E6C67A" },
  "14w": { name: "14k White Gold",  wizard: "White gold",  color: "#EDEEF2", density: 12.7, sw: "#E8E8EA" },
  "14r": { name: "14k Rose Gold",   wizard: "Rose gold",   color: "#EBAC8E", density: 13.0, sw: "#E6B0A0" },
  "18y": { name: "18k Yellow Gold", wizard: "Yellow gold", color: "#EDB84F", density: 15.5, sw: "#E0B85E" },
  "18w": { name: "18k White Gold",  wizard: "White gold",  color: "#E9EAEF", density: 15.1, sw: "#E0E0E4" },
  "18r": { name: "18k Rose Gold",   wizard: "Rose gold",   color: "#E6A07F", density: 15.2, sw: "#DFA08E" },
  "pt":  { name: "Platinum 950",    wizard: "Platinum",    color: "#E2E4E9", density: 20.6, sw: "#D8DADE" },
};
const FINISHES = {
  polished: { name: "Polished",  roughness: 0.09 },
  satin:    { name: "Satin",     roughness: 0.34, anisotropy: 0.75 },
  hammered: { name: "Hammered",  roughness: 0.1, bump: true },
  matte:    { name: "Matte",     roughness: 0.62 },
};
const STONES = { none: "None", half: "Half eternity", full: "Full eternity" };
const FONTS = {
  script: 'italic 500 104px "Cormorant Garamond", Georgia, serif',
  serif:  '500 96px "Cormorant Garamond", Georgia, serif',
  sans:   '400 78px "DM Sans", system-ui, sans-serif',
};
const sizeToDiameter = (us) => 11.66 + 0.811 * us; // matches the ring-size guide chart
const MIN_STONE_WIDTH = 2.5;

const state = {
  profile: "court", interior: "comfort", width: 4, depth: 1.8, metal: "18y",
  finish: "polished", stones: "none", size: 7, engraving: "", font: "script",
};

// ── State from a shared link ─────────────────────────────────────────────────
function readHash() {
  const q = new URLSearchParams(location.hash.slice(1));
  const pick = (k, table) => { const v = q.get(k); if (v && table[v]) state[k] = v; };
  pick("profile", PROFILES); pick("interior", INTERIORS); pick("metal", METALS);
  pick("finish", FINISHES); pick("stones", STONES); pick("font", FONTS);
  const num = (k, lo, hi) => { const v = parseFloat(q.get(k)); if (Number.isFinite(v)) state[k] = Math.min(hi, Math.max(lo, v)); };
  num("width", 2, 8); num("depth", 1.2, 2.6); num("size", 4, 13);
  const e = q.get("engraving"); if (e != null) state.engraving = e.slice(0, 30);
}
function writeHash() {
  const q = new URLSearchParams();
  for (const k of ["profile", "interior", "width", "depth", "metal", "finish", "stones", "size", "font"]) q.set(k, state[k]);
  if (state.engraving) q.set("engraving", state.engraving);
  history.replaceState(null, "", "#" + q.toString());
}

// ── Cross-section ────────────────────────────────────────────────────────────
// Points are {x: radius, y: along the ring axis}, in mm. The loop runs: outer
// surface (y rising) → side → inner surface (y falling) → side, and a channel
// for stones is notched into the outer surface. Each "run" is shaded smoothly
// on its own, so channel walls stay crisp.
function outerRadius(s, ri, y) {
  const w = s.width, t = s.depth, u = Math.abs(2 * y / w);
  switch (s.profile) {
    case "flat":   return ri + t;
    case "court":  return ri + t - 0.28 * t * u * u;
    case "dshape": return ri + 0.3 * t + 0.7 * t * Math.sqrt(Math.max(0, 1 - u * u));
    case "knife":  return ri + t - 0.5 * t * u;
    case "bevel":  return u <= 0.55 ? ri + t : ri + t - 0.32 * t * ((u - 0.55) / 0.45);
  }
  return ri + t;
}
function innerRadius(s, ri, y) {
  if (s.interior !== "comfort") return ri;
  const u = 2 * y / s.width;
  return ri + Math.min(0.32 * s.depth, 0.45) * u * u;
}
// Fillet the sharp interior corners of an open polyline (quadratic arcs).
function roundCorners(pts, r) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], p = pts[i], b = pts[i + 1];
    const ax = a.x - p.x, ay = a.y - p.y, bx = b.x - p.x, by = b.y - p.y;
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    const cosT = (ax * bx + ay * by) / (la * lb);
    if (cosT < -0.985 || la === 0 || lb === 0) { out.push(p); continue; } // ~straight
    const d = Math.min(r, la * 0.45, lb * 0.45);
    const t1 = { x: p.x + ax / la * d, y: p.y + ay / la * d };
    const t2 = { x: p.x + bx / lb * d, y: p.y + by / lb * d };
    for (let k = 0; k <= 6; k++) {
      const u = k / 6, v = 1 - u;
      out.push({ x: v * v * t1.x + 2 * u * v * p.x + u * u * t2.x, y: v * v * t1.y + 2 * u * v * p.y + u * u * t2.y });
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}
function stoneSpec(s) {
  if (s.stones === "none" || s.width < MIN_STONE_WIDTH) return null;
  const d = Math.min(Math.max(Math.round((s.width - 1.4) * 0.6 * 10) / 10, 1.2), 2.4, s.width - 1.1);
  return { d, channelW: d + 0.14, channelD: 0.5 * d + 0.05, pitch: d + 0.16 };
}
function buildSection(s) {
  const ri = sizeToDiameter(s.size) / 2;
  const w = s.width, hw = w / 2;
  const st = stoneSpec(s);
  const cw = st ? st.channelW / 2 : 0;
  // outer samples, including the channel edges exactly
  const ys = [];
  const N = 40;
  for (let i = 0; i <= N; i++) ys.push(-hw + w * i / N);
  if (st) ys.push(-cw, cw);
  ys.sort((a, b) => a - b);
  const outer = ys.filter((y, i) => i === 0 || Math.abs(y - ys[i - 1]) > 1e-6).map((y) => ({ x: outerRadius(s, ri, y), y }));
  const iL = st ? outer.findIndex((p) => Math.abs(p.y + cw) < 1e-6) : -1;
  const iR = st ? outer.findIndex((p) => Math.abs(p.y - cw) < 1e-6) : -1;
  // inner samples (y falling)
  const inner = [];
  const M = s.interior === "comfort" ? 24 : 1;
  for (let i = 0; i <= M; i++) { const y = hw - w * i / M; inner.push({ x: innerRadius(s, ri, y), y }); }
  const fillet = Math.min(0.2, 0.12 * s.depth, 0.08 * w);
  let rest, floor;
  if (st) {
    rest = roundCorners([...outer.slice(iR), ...inner, ...outer.slice(0, iL + 1)], fillet);
    floor = outer.slice(iL, iR + 1);
  } else {
    rest = roundCorners([...outer, ...inner, outer[0]], fillet);
    floor = null;
  }
  return { ri, rest, floor, stone: st, centerOuter: outerRadius(s, ri, 0) };
}

// ── Lathe with per-run normals and a channel whose depth varies with angle ──
const SEG = 192;
const TOP = Math.PI / 2; // lathe angle that ends up at the top of the standing ring
function buildRingGeometry(sec, s) {
  const runsAt = (depth) => {
    if (!sec.floor) return [sec.rest];
    const fl = sec.floor.map((p) => ({ x: p.x - depth, y: p.y }));
    const top0 = sec.floor[0], top1 = sec.floor[sec.floor.length - 1];
    return [sec.rest, [top0, fl[0]], fl, [fl[fl.length - 1], top1]];
  };
  const depthAt = channelDepthFn(sec, s);
  const runs0 = runsAt(0);
  const counts = runs0.map((r) => r.length);
  const total = counts.reduce((a, b) => a + b, 0);
  const pos = new Float32Array((SEG + 1) * total * 3);
  const nor = new Float32Array((SEG + 1) * total * 3);
  const uv = new Float32Array((SEG + 1) * total * 2);
  // arc-length v for texture tiling
  let loopLen = 0;
  for (const r of runs0) for (let j = 1; j < r.length; j++) loopLen += Math.hypot(r[j].x - r[j - 1].x, r[j].y - r[j - 1].y);
  let volume = 0;
  for (let sIdx = 0; sIdx <= SEG; sIdx++) {
    const th = sIdx / SEG * Math.PI * 2;
    const c = Math.cos(th), sn = Math.sin(th);
    const runs = runsAt(depthAt(th));
    let vi = sIdx * total, acc = 0;
    const loop = [];
    for (const r of runs) {
      for (let j = 0; j < r.length; j++) {
        const p = r[j];
        const a = r[Math.max(0, j - 1)], b = r[Math.min(r.length - 1, j + 1)];
        let tx = b.x - a.x, ty = b.y - a.y, l = Math.hypot(tx, ty);
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
      // Pappus: wedge volume = area × centroid radius × dθ
      let A = 0, cx = 0;
      for (let i = 0; i < loop.length; i++) {
        const p = loop[i], q = loop[(i + 1) % loop.length];
        const cr = p.x * q.y - q.x * p.y;
        A += cr; cx += (p.x + q.x) * cr;
      }
      A *= 0.5; if (Math.abs(A) > 1e-9) cx /= 6 * A;
      volume += Math.abs(A) * Math.abs(cx) * (Math.PI * 2 / SEG);
    }
  }
  const idx = [];
  for (let sIdx = 0; sIdx < SEG; sIdx++) {
    let base = 0;
    for (const n of counts) {
      for (let j = 0; j < n - 1; j++) {
        const a = sIdx * total + base + j, b = a + 1, c2 = a + total, d = c2 + 1;
        idx.push(a, c2, b, b, c2, d);
      }
      base += n;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  // make sure winding agrees with the normals
  const pa = new THREE.Vector3().fromArray(pos, idx[0] * 3), pb = new THREE.Vector3().fromArray(pos, idx[1] * 3), pc = new THREE.Vector3().fromArray(pos, idx[2] * 3);
  const fn = pb.clone().sub(pa).cross(pc.clone().sub(pa)); // three.js front face = counter-clockwise (a,b,c)
  if (fn.dot(new THREE.Vector3().fromArray(nor, idx[0] * 3)) < 0) {
    for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
    g.setIndex(idx);
  }
  g.computeBoundingSphere();
  return { geometry: g, volumeMm3: volume, loopLen, circumference: 2 * Math.PI * sec.centerOuter };
}
function stoneLayout(sec, s) {
  const st = sec.stone;
  if (!st) return null;
  const rg = sec.centerOuter - st.channelD + 0.40 * st.d; // girdle radius
  const pitchAng = st.pitch / rg;
  let n, start;
  if (s.stones === "full") { n = Math.floor(2 * Math.PI / pitchAng); start = 0; }
  else { n = Math.floor(Math.PI / pitchAng); start = TOP - (n - 1) / 2 * pitchAng; }
  const ang = s.stones === "full" ? 2 * Math.PI / n : pitchAng;
  return { n, rg, d: st.d, angles: Array.from({ length: n }, (_, i) => start + i * ang), pitchAng, halfSpan: s.stones === "full" ? Math.PI : (n - 1) / 2 * pitchAng };
}
function channelDepthFn(sec, s) {
  const st = sec.stone;
  if (!st) return () => 0;
  if (s.stones === "full") return () => st.channelD;
  const lay = stoneLayout(sec, s);
  const end = lay.halfSpan + 0.72 * lay.pitchAng, ramp = 0.55 * lay.pitchAng;
  return (th) => {
    let a = ((th - TOP + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    a = Math.abs(a);
    if (a <= end - ramp) return st.channelD;
    if (a >= end) return 0;
    const u = (end - a) / ramp;
    return st.channelD * u * u * (3 - 2 * u);
  };
}
function brilliantGeometry(d) {
  const r = d / 2;
  const pts = [
    new THREE.Vector2(0, 0.16 * d), new THREE.Vector2(0.56 * r, 0.16 * d), new THREE.Vector2(r, 0.02 * d),
    new THREE.Vector2(r, -0.02 * d), new THREE.Vector2(0.02 * r, -0.43 * d), new THREE.Vector2(0, -0.43 * d),
  ];
  const g = new THREE.LatheGeometry(pts, 16).toNonIndexed();
  g.computeVertexNormals();
  return g;
}

// ── Textures ─────────────────────────────────────────────────────────────────
function hammeredBump() {
  const c = document.createElement("canvas"); c.width = c.height = 512;
  const x = c.getContext("2d");
  x.fillStyle = "#808080"; x.fillRect(0, 0, 512, 512);
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 110; i++) {
    const px = rnd() * 512, py = rnd() * 512, r = 26 + rnd() * 30;
    const g = x.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, "rgba(40,40,40,0.9)"); g.addColorStop(0.75, "rgba(128,128,128,0.4)"); g.addColorStop(1, "rgba(200,200,200,0)");
    x.fillStyle = g;
    // tile across edges
    for (const [ox, oy] of [[0, 0], [512, 0], [-512, 0], [0, 512], [0, -512]]) { x.beginPath(); x.arc(px + ox, py + oy, r, 0, Math.PI * 2); x.fill(); }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
let engravingTex = null, engravingCanvas = null;
function engravingTexture(text, font) {
  if (!engravingCanvas) { engravingCanvas = document.createElement("canvas"); engravingCanvas.width = 2048; engravingCanvas.height = 160; }
  const c = engravingCanvas, x = c.getContext("2d");
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.clearRect(0, 0, c.width, c.height);
  if (text) {
    x.save();
    x.translate(0, c.height); x.scale(1, -1); // reads upright on the inside of the band
    x.font = FONTS[font] || FONTS.script;
    x.textAlign = "center"; x.textBaseline = "middle";
    const maxW = c.width * 0.5;
    const w = x.measureText(text).width;
    if (w > maxW) x.scale(maxW / w, 1);
    x.fillStyle = "rgba(38,32,26,0.88)";
    x.fillText(text, c.width / 2 * (w > maxW ? w / maxW : 1), c.height / 2 + 4);
    x.restore();
  }
  if (!engravingTex) { engravingTex = new THREE.CanvasTexture(c); engravingTex.anisotropy = 8; engravingTex.colorSpace = THREE.SRGBColorSpace; }
  engravingTex.needsUpdate = true;
  return engravingTex;
}

// ── Scene ────────────────────────────────────────────────────────────────────
const viewer = document.getElementById("bbViewer");
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.outputColorSpace = THREE.SRGBColorSpace;
viewer.appendChild(renderer.domElement);

const scene = new THREE.Scene();
// A soft studio: a graded dome plus a few moderate softboxes. The stock
// RoomEnvironment's panels are so bright that polished gold tone-maps to white.
function studioEnvironment() {
  const env = new THREE.Scene();
  const grad = document.createElement("canvas"); grad.width = 4; grad.height = 256;
  const gx = grad.getContext("2d"), lg = gx.createLinearGradient(0, 0, 0, 256);
  // mid-grey on average, so polished metal reflects its own colour rather than white
  lg.addColorStop(0, "#f2f4f8"); lg.addColorStop(0.42, "#c3c8d3"); lg.addColorStop(0.58, "#8e949f"); lg.addColorStop(1, "#353942");
  gx.fillStyle = lg; gx.fillRect(0, 0, 4, 256);
  const domeTex = new THREE.CanvasTexture(grad); domeTex.colorSpace = THREE.SRGBColorSpace;
  env.add(new THREE.Mesh(new THREE.SphereGeometry(60, 32, 24), new THREE.MeshBasicMaterial({ map: domeTex, side: THREE.BackSide })));
  const box = (w, h, x, y, z, i, warm) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(warm ? 0xfff2df : 0xeef3ff).multiplyScalar(i), side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.lookAt(0, 0, 0); env.add(m);
  };
  box(22, 10, 10, 30, 22, 4.0, true);   // key, top front
  box(8, 36, -40, 8, 6, 2.6, false);    // tall left strip
  box(7, 28, 42, 2, -10, 2.0, false);   // right rim strip
  box(36, 4, 0, -6, -48, 1.6, true);    // low back bar
  return env;
}
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(studioEnvironment(), 0.02).texture;
scene.environmentIntensity = 1.0;

const camera = new THREE.PerspectiveCamera(28, 1, 1, 500);
camera.position.set(30, 22, 46);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.enablePan = false; controls.minDistance = 30; controls.maxDistance = 120;
controls.autoRotate = true; controls.autoRotateSpeed = 0.9;
controls.maxPolarAngle = Math.PI * 0.6; controls.minPolarAngle = Math.PI * 0.15;
let idleTimer = 0;
controls.addEventListener("start", () => { controls.autoRotate = false; clearTimeout(idleTimer); });
controls.addEventListener("end", () => { idleTimer = setTimeout(() => (controls.autoRotate = true), 7000); });

// Lit by the environment alone: a direct light on near-mirror metal is one
// enormous highlight that tone-maps the whole band to white.

const group = new THREE.Group();
const LEAN = Math.PI / 2 + 0.22; // lathe axis Y → mostly Z: the ring stands, its top tipped toward the viewer so the band shows
group.rotation.x = LEAN;
scene.add(group);

// soft contact shadow
const shadowC = document.createElement("canvas"); shadowC.width = shadowC.height = 256;
{ const x = shadowC.getContext("2d"); const g = x.createRadialGradient(128, 128, 10, 128, 128, 128);
  g.addColorStop(0, "rgba(20,24,40,0.42)"); g.addColorStop(0.5, "rgba(20,24,40,0.16)"); g.addColorStop(1, "rgba(20,24,40,0)");
  x.fillStyle = g; x.fillRect(0, 0, 256, 256); }
const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shadowC), transparent: true, depthWrite: false }));
shadow.rotation.x = -Math.PI / 2;
scene.add(shadow);

const metalMat = new THREE.MeshPhysicalMaterial({ metalness: 1, roughness: 0.07, envMapIntensity: 1 });
const bumpTex = hammeredBump();
const stoneMat = new THREE.MeshPhysicalMaterial({
  color: 0xffffff, metalness: 0, roughness: 0.02, ior: 2.42, reflectivity: 1,
  transmission: 0.3, thickness: 1.0, envMapIntensity: 2.6, flatShading: true, specularIntensity: 1,
});
const engraveMat = new THREE.MeshBasicMaterial({ transparent: true, side: THREE.BackSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });

let ringMesh = null, stonesMesh = null, engraveMesh = null;
let metrics = { grams: 0, stones: 0, carats: 0 };

function rebuild() {
  const sec = buildSection(state);
  const built = buildRingGeometry(sec, state);
  if (ringMesh) { ringMesh.geometry.dispose(); group.remove(ringMesh); }
  ringMesh = new THREE.Mesh(built.geometry, metalMat);
  group.add(ringMesh);
  // hammered dimples ≈ 1.6 mm across; tile by real size
  bumpTex.repeat.set(built.circumference / (1.6 * 6), built.loopLen / (1.6 * 6));

  if (stonesMesh) { stonesMesh.geometry.dispose(); group.remove(stonesMesh); stonesMesh = null; }
  const lay = stoneLayout(sec, state);
  if (lay) {
    stonesMesh = new THREE.InstancedMesh(brilliantGeometry(lay.d), stoneMat, lay.n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), radial = new THREE.Vector3();
    lay.angles.forEach((th, i) => {
      radial.set(Math.cos(th), 0, -Math.sin(th));
      q.setFromUnitVectors(up, radial);
      m.compose(radial.clone().multiplyScalar(lay.rg), q, new THREE.Vector3(1, 1, 1));
      stonesMesh.setMatrixAt(i, m);
    });
    stonesMesh.instanceMatrix.needsUpdate = true;
    group.add(stonesMesh);
  }

  if (engraveMesh) { engraveMesh.geometry.dispose(); group.remove(engraveMesh); engraveMesh = null; }
  if (state.engraving.trim()) {
    const h = Math.min(state.width * 0.55, 2.2);
    engraveMesh = new THREE.Mesh(new THREE.CylinderGeometry(sec.ri - 0.015, sec.ri - 0.015, h, 128, 1, true), engraveMat);
    engraveMat.map = engravingTexture(state.engraving.trim(), state.font);
    engraveMesh.rotation.y = Math.PI; // text centred at the front
    group.add(engraveMesh);
  }

  const ro = sec.centerOuter + 0.1;
  shadow.position.set(0, -ro * Math.sin(LEAN) - 0.2, 0);
  shadow.scale.set(ro * 2.6, ro * 2.6 * Math.abs(Math.cos(LEAN)) + state.width * 1.6, 1);
  controls.target.set(0, 0, 0);

  // metrics
  const stoneVol = lay ? lay.n * 0.5 * (4 / 3) * Math.PI * Math.pow(lay.d / 2, 3) : 0; // seat the metal doesn't fill
  metrics.grams = (built.volumeMm3 - stoneVol * 0.4) / 1000 * METALS[state.metal].density;
  metrics.stones = lay ? lay.n : 0;
  metrics.carats = lay ? lay.n * Math.pow(lay.d / 6.5, 3) : 0;
  metrics.stoneMm = lay ? lay.d : 0;
}
function applyMaterial() {
  const met = METALS[state.metal], fin = FINISHES[state.finish];
  metalMat.color.set(met.color);
  metalMat.roughness = fin.roughness;
  metalMat.anisotropy = fin.anisotropy || 0;
  metalMat.anisotropyRotation = Math.PI / 2;
  metalMat.bumpMap = fin.bump ? bumpTex : null;
  metalMat.bumpScale = fin.bump ? 2.2 : 0;
  metalMat.needsUpdate = true;
}

function resize() {
  const w = viewer.clientWidth, h = viewer.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(viewer);
resize();
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });

// ── UI ───────────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const fmt = (n, d = 1) => Number(n).toFixed(d).replace(/\.0$/, "");
function usSize(v) { const whole = Math.floor(v); return v % 1 ? `${whole}½` : String(whole); }

function syncUI() {
  document.querySelectorAll("[data-opt]").forEach((b) => {
    const on = state[b.dataset.opt] === b.dataset.v;
    b.classList.toggle("on", on); b.setAttribute("aria-pressed", on);
  });
  $("bbWidth").value = state.width; $("bbWidthV").textContent = fmt(state.width) + " mm";
  $("bbDepth").value = state.depth; $("bbDepthV").textContent = fmt(state.depth) + " mm";
  $("bbSize").value = String(state.size);
  $("bbEngrave").value = state.engraving; $("bbFont").value = state.font;
  $("bbEngraveCount").textContent = `${state.engraving.length}/30`;
  const stonesOk = state.width >= MIN_STONE_WIDTH;
  $("bbStoneNote").hidden = stonesOk;
  document.querySelectorAll('[data-opt="stones"]').forEach((b) => { if (b.dataset.v !== "none") b.disabled = !stonesOk; });

  const met = METALS[state.metal];
  const rows = [
    ["Profile", `${PROFILES[state.profile].name} · ${INTERIORS[state.interior]}`],
    ["Width", `${fmt(state.width)} mm`], ["Depth", `${fmt(state.depth)} mm`],
    ["Metal", met.name], ["Finish", FINISHES[state.finish].name],
    ["Diamonds", metrics.stones ? `${STONES[state.stones]} · ${metrics.stones} × ${fmt(metrics.stoneMm)} mm (≈${fmt(metrics.carats, 2)} ct tw)` : "None"],
    ["Size", `US ${usSize(state.size)} · ${fmt(sizeToDiameter(state.size))} mm inside`],
    ["Engraving", state.engraving.trim() ? `“${state.engraving.trim()}”` : "—"],
    ["Est. metal weight", `≈ ${fmt(metrics.grams)} g`],
  ];
  $("bbSummary").innerHTML = rows.map(([k, v]) => `<div class="bb-row"><span>${k}</span><b>${v}</b></div>`).join("");
  $("bbChip").textContent = `${met.name} · ${fmt(state.width)} mm ${PROFILES[state.profile].name.toLowerCase()} · ≈${fmt(metrics.grams)} g`;
}
function update(geom = true) {
  if (geom) rebuild();
  applyMaterial();
  syncUI();
  writeHash();
}

document.querySelectorAll("[data-opt]").forEach((b) => b.addEventListener("click", () => {
  if (b.disabled) return;
  state[b.dataset.opt] = b.dataset.v;
  update(b.dataset.opt !== "metal" && b.dataset.opt !== "finish");
}));
$("bbWidth").addEventListener("input", (e) => { state.width = parseFloat(e.target.value); if (state.width < MIN_STONE_WIDTH) state.stones = "none"; update(); });
$("bbDepth").addEventListener("input", (e) => { state.depth = parseFloat(e.target.value); update(); });
$("bbSize").addEventListener("change", (e) => { state.size = parseFloat(e.target.value); update(); });
$("bbEngrave").addEventListener("input", (e) => { state.engraving = e.target.value.slice(0, 30); update(); });
$("bbFont").addEventListener("change", (e) => { state.font = e.target.value; update(); });

$("bbReset").addEventListener("click", () => {
  Object.assign(state, { profile: "court", interior: "comfort", width: 4, depth: 1.8, metal: "18y", finish: "polished", stones: "none", size: 7, engraving: "", font: "script" });
  update();
});
$("bbCopy").addEventListener("click", async () => {
  writeHash();
  const btn = $("bbCopy"), old = btn.textContent;
  try { await navigator.clipboard.writeText(location.href); btn.textContent = "Link copied"; }
  catch { prompt("Copy this link:", location.href); }
  setTimeout(() => (btn.textContent = old), 1800);
});
$("bbSave").addEventListener("click", () => {
  renderer.render(scene, camera);
  const a = document.createElement("a");
  a.download = `azoir-wedding-band-${state.metal}-${fmt(state.width)}mm.png`;
  a.href = renderer.domElement.toDataURL("image/png");
  a.click();
});
// Hand the design to the commission wizard (same localStorage it reads).
$("bbRequest").addEventListener("click", () => {
  const met = METALS[state.metal];
  const spec = [
    `Wedding band from the builder (${location.href})`,
    `Profile: ${PROFILES[state.profile].name}, ${INTERIORS[state.interior].toLowerCase()} interior`,
    `Width ${fmt(state.width)} mm · depth ${fmt(state.depth)} mm · size US ${usSize(state.size)}`,
    `Metal: ${met.name} · finish: ${FINISHES[state.finish].name}`,
    metrics.stones ? `Diamonds: ${STONES[state.stones].toLowerCase()}, ${metrics.stones} × ${fmt(metrics.stoneMm)} mm` : "Diamonds: none",
    state.engraving.trim() ? `Engraving: "${state.engraving.trim()}"` : "",
    `Estimated weight ≈ ${fmt(metrics.grams)} g`,
  ].filter(Boolean).join("\n");
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem("azoir_wiz") || "{}"); } catch {}
  saved.type = "Wedding bands";
  saved.metal = met.wizard;
  if (metrics.stones && !saved.stone) saved.stone = "";
  else if (!metrics.stones) saved.stone = "No stone";
  saved.message = spec + (saved.message && !/Wedding band from the builder/.test(saved.message) ? "\n\n" + saved.message : "");
  saved.step = 2;
  try { localStorage.setItem("azoir_wiz", JSON.stringify(saved)); } catch {}
  location.href = "commission.html?from=band-builder";
});

readHash();
update();
document.fonts?.ready.then(() => { if (state.engraving.trim()) update(); });
window.__bandBuilder = { state, metrics, scene, renderer, camera, rebuild: update };
