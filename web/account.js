// My account — sign in by emailed code, then orders, details, addresses and saved pieces.
// Talks only to this site's /account/api/* (server.js → commerce.js), which keeps the sign-in in an
// httpOnly cookie; nothing secret is held in this script.
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (m) => (m ? Number(m.amount).toLocaleString("en-US", { style: "currency", currency: m.currencyCode || "USD" }) : "—");
  const date = (s) => new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  async function api(path, opts = {}) {
    const r = await fetch(`/account/api${path}`, {
      method: opts.method || "GET",
      headers: opts.body !== undefined ? { "Content-Type": "application/json" } : {},
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: "same-origin",
    });
    let body = null;
    try { body = await r.json(); } catch {}
    return { status: r.status, body: body || {} };
  }

  const ERR = {
    invalid_email: "Please enter a valid email address.",
    invalid_code: "That code isn't right or has expired. Check the latest email, or send a new code.",
    disabled: "This account is closed. Email hello@azoir.co and we'll help.",
    too_many_requests: "Too many tries — please wait a few minutes and try again.",
    unavailable: "Accounts are briefly unavailable. Please try again in a minute.",
  };
  const errText = (b) => ERR[b.error] || "Something went wrong. Please try again.";

  let email = "", me = null;

  function show(view) {
    $("acctSignIn").hidden = view !== "signin";
    $("acctBody").hidden = view !== "account";
    $("acctSignOut").hidden = view !== "account";
    $("acctLede").hidden = view === "account";
  }
  function signInError(msg) { const e = $("acctSignInErr"); e.textContent = msg || ""; e.hidden = !msg; }

  // ── Sign in ───────────────────────────────────────────────────────────────
  $("acctEmailForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    email = $("acctEmail").value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return signInError(ERR.invalid_email);
    $("acctEmailBtn").disabled = true; signInError("");
    const r = await api("/login-code", { method: "POST", body: { email } });
    $("acctEmailBtn").disabled = false;
    if (r.status !== 200) return signInError(errText(r.body));
    $("acctCodeSent").textContent = `We sent a 6-digit code to ${email}. It works for 10 minutes.`;
    $("acctEmailForm").hidden = true; $("acctCodeForm").hidden = false; $("acctCode").value = ""; $("acctCode").focus();
  });
  $("acctRestart").addEventListener("click", () => { $("acctCodeForm").hidden = true; $("acctEmailForm").hidden = false; signInError(""); $("acctEmail").focus(); });
  $("acctCode").addEventListener("input", () => { const v = $("acctCode").value.replace(/\D/g, "").slice(0, 6); $("acctCode").value = v; if (v.length === 6) $("acctCodeForm").requestSubmit(); });
  $("acctCodeForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = $("acctCode").value.trim();
    if (!/^\d{6}$/.test(code)) return signInError("Enter the 6-digit code from the email.");
    $("acctCodeBtn").disabled = true; signInError("");
    const r = await api("/sign-in", { method: "POST", body: { email, code } });
    $("acctCodeBtn").disabled = false;
    if (r.status >= 300) return signInError(errText(r.body));
    await load();
  });
  $("acctSignOut").addEventListener("click", async () => {
    await api("/sign-out", { method: "POST", body: {} });
    me = null; $("acctEmailForm").hidden = false; $("acctCodeForm").hidden = true; $("acctTitle").textContent = "Your account";
    show("signin");
  });

  // ── Account ───────────────────────────────────────────────────────────────
  async function load() {
    const r = await api("/me");
    if (r.status === 401) { show("signin"); return; }
    if (r.status !== 200) { show("signin"); return signInError(errText(r.body)); }
    me = r.body.customer;
    $("acctTitle").textContent = me.firstName ? `Welcome, ${me.firstName}` : "Your account";
    $("pFirst").value = me.firstName || ""; $("pLast").value = me.lastName || ""; $("pEmail").value = me.email; $("pPhone").value = me.phone || "";
    $("pMarketing").checked = !!me.acceptsMarketing;
    renderAddresses();
    show("account");
    const [orders, wish] = await Promise.all([api("/orders"), api("/wishlist")]);
    renderOrders(orders.status === 200 ? orders.body.orders : null);
    renderWishlist(wish.status === 200 ? wish.body.products : null);
  }

  function renderOrders(list) {
    const el = $("acctOrders");
    if (!list) { el.innerHTML = `<p class="acct-empty">Your orders couldn't be loaded just now.</p>`; return; }
    if (!list.length) { el.innerHTML = `<p class="acct-empty">No orders yet. When you reserve a <a href="/wedding-bands.html" style="text-decoration:underline">wedding band</a> or commission a piece with this email, it appears here.</p>`; return; }
    el.innerHTML = list.map((o) => `<div class="acct-row"><div><b>${esc(o.number)}</b> · ${esc(o.kind === "band" ? "Wedding band" : "Commission")}<small>${esc(o.statusLabel)} · ${esc(date(o.processedAt))}</small></div><div class="amt">${o.totalPrice ? esc(money(o.totalPrice)) : "Price to be confirmed"}${o.refunded ? `<small>${esc(money(o.refunded))} refunded</small>` : ""}</div></div>`).join("");
  }

  function renderWishlist(list) {
    const el = $("acctWishlist");
    if (!list || !list.length) { el.innerHTML = `<p class="acct-empty">Nothing saved yet.</p>`; return; }
    el.innerHTML = list.map((p) => `<div class="acct-row"><div><b>${esc(p.title)}</b><small>${esc(p.productType || "")}</small></div><div class="amt">${p.priceRange ? esc(money(p.priceRange.minVariantPrice)) : ""}</div></div>`).join("");
  }

  function renderAddresses() {
    const el = $("acctAddresses");
    const list = me.addresses || [];
    if (!list.length) { el.innerHTML = `<p class="acct-empty">No saved addresses.</p>`; return; }
    el.innerHTML = list.map((a) => `<div class="acct-row"><div>${a.formatted.map(esc).join("<br>")}${a.isDefault ? "<small>Default</small>" : ""}</div><div class="amt">${a.isDefault ? "" : `<button type="button" class="acct-link" data-default="${esc(a.id)}">Make default</button><br>`}<button type="button" class="acct-link" data-remove="${esc(a.id)}">Remove</button></div></div>`).join("");
  }

  $("acctAddresses").addEventListener("click", async (e) => {
    const rm = e.target.closest("[data-remove]"), def = e.target.closest("[data-default]");
    if (rm) {
      if (!confirm("Remove this address?")) return;
      const r = await api(`/addresses/${rm.dataset.remove}`, { method: "DELETE" });
      if (r.status === 200) await load();
    } else if (def) {
      const a = (me.addresses || []).find((x) => x.id === def.dataset.default);
      if (!a) return;
      const r = await api(`/addresses/${a.id}`, { method: "PATCH", body: { name: a.name, company: a.company, address1: a.address1, address2: a.address2, city: a.city, province: a.province, zip: a.zip, countryCode: a.countryCode, phone: a.phone, isDefault: true } });
      if (r.status === 200) await load();
    }
  });

  $("aAdd").addEventListener("click", () => { $("acctAddrForm").hidden = false; $("aMsg").textContent = ""; $("acctAddrForm").elements.address1.focus(); });
  $("aCancel").addEventListener("click", () => { $("acctAddrForm").reset(); $("acctAddrForm").hidden = true; });
  $("acctAddrForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.currentTarget.elements;
    const body = {
      name: f.name.value, company: f.company.value, address1: f.address1.value, address2: f.address2.value, city: f.city.value,
      province: f.province.value, zip: f.zip.value, countryCode: f.countryCode.value.trim().toUpperCase(), phone: f.phone.value, isDefault: f.isDefault.checked,
    };
    const r = await api("/addresses", { method: "POST", body });
    if (r.status !== 201) { $("aMsg").textContent = r.body.message || errText(r.body); return; }
    e.currentTarget.reset(); $("acctAddrForm").hidden = true;
    await load();
  });

  $("acctProfile").addEventListener("submit", async (e) => {
    e.preventDefault();
    const r = await api("/me", { method: "PATCH", body: { firstName: $("pFirst").value, lastName: $("pLast").value, phone: $("pPhone").value, acceptsMarketing: $("pMarketing").checked } });
    $("pMsg").className = r.status === 200 ? "acct-msg" : "acct-msg err";
    $("pMsg").textContent = r.status === 200 ? "Saved." : errText(r.body);
    if (r.status === 200) { me = r.body.customer; $("acctTitle").textContent = me.firstName ? `Welcome, ${me.firstName}` : "Your account"; }
  });

  load();
})();
