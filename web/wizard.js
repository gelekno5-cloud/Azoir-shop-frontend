/* Azoir & Co. — guided commission wizard.
   7 steps, one question per screen, visual pickers, progress, back/forward,
   inspiration-photo upload, answers persist in localStorage. */
(function () {
  var KEY = "azoir_wiz";
  var TOTAL = 7;
  var MAX_IMAGES = 5;
  var MAX_EDGE = 1600; // longest side after the in-browser resize
  var state = { type: "", metal: "", stone: "", budget: "", timeline: "", message: "", name: "", email: "", phone: "", images: [], step: 1 };
  try { Object.assign(state, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch (e) {}
  if (!Array.isArray(state.images)) state.images = [];

  var wizard = document.getElementById("wizard");
  if (!wizard) return;
  var steps = [].slice.call(wizard.querySelectorAll(".wiz-step"));
  var bar = document.getElementById("wizBar");
  var count = document.getElementById("wizCount");
  var backBtn = document.getElementById("wizBack");
  var nextBtn = document.getElementById("wizNext");
  var errBox = document.getElementById("wizErr");
  var errText = errBox.textContent;
  var msg = document.getElementById("wizMessage");
  var nameI = document.getElementById("wizName");
  var emailI = document.getElementById("wizEmail");
  var phoneI = document.getElementById("wizPhone");
  var summary = document.getElementById("wizSummary");
  var form = document.getElementById("wizForm");
  var fileI = document.getElementById("wizFile");
  var addBtn = document.getElementById("wizAddPhoto");
  var thumbs = document.getElementById("wizThumbs");
  var upErr = document.getElementById("wizUpErr");
  var uploading = 0;
  // Bot guard: stamp the first render. The server rejects submissions that
  // arrive without it (direct POSTs) or faster than a human can fill a form.
  // The stamp lives in the saved answers so a return from the Stripe checkout
  // isn't "too fast"; it renews past 5h, inside the server's 6h limit.
  if (!(state.fg_ts <= Date.now() && Date.now() - state.fg_ts < 5 * 60 * 60 * 1000)) state.fg_ts = Date.now();
  if (form && form.elements.fg_ts) form.elements.fg_ts.value = String(state.fg_ts);

  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }
  function validEmail(e) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e); }

  // restore text fields + card selections
  if (msg) msg.value = state.message || "";
  if (nameI) nameI.value = state.name || "";
  if (emailI) emailI.value = state.email || "";
  if (phoneI) phoneI.value = state.phone || "";
  wizard.querySelectorAll(".wiz-cards").forEach(function (group) {
    var f = group.getAttribute("data-field");
    if (!state[f]) return;
    group.querySelectorAll(".wcard").forEach(function (c) {
      if (c.getAttribute("data-v") === state[f]) c.classList.add("on");
    });
  });

  var current = Math.min(Math.max(parseInt(state.step, 10) || 1, 1), TOTAL);

  function buildSummary() {
    var rows = [["Piece", state.type], ["Metal", state.metal], ["Stone", state.stone], ["Budget", state.budget], ["Timeline", state.timeline]];
    var html = rows.filter(function (r) { return r[1]; }).map(function (r) {
      return '<div class="wsum-row"><span>' + r[0] + "</span><b>" + r[1] + "</b></div>";
    }).join("");
    if (state.images.length) {
      html += '<div class="wsum-thumbs">' + state.images.map(function (u) {
        return '<img src="' + u + '" alt="Inspiration photo">';
      }).join("") + "</div>";
    }
    summary.innerHTML = html ? '<div class="wsum-title">Your commission so far</div>' + html : "";
  }

  function render() {
    steps.forEach(function (s) { s.classList.toggle("active", +s.getAttribute("data-step") === current); });
    bar.style.width = (current / TOTAL * 100) + "%";
    count.textContent = "Step " + current + " of " + TOTAL;
    backBtn.style.visibility = current === 1 ? "hidden" : "visible";
    nextBtn.textContent = current === TOTAL ? "Pay $60 & send request" : "Next";
    if (current === TOTAL) buildSummary();
    state.step = current; save();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  wizard.addEventListener("click", function (e) {
    var card = e.target.closest(".wcard");
    if (!card) return;
    var group = card.closest(".wiz-cards");
    var f = group.getAttribute("data-field");
    group.querySelectorAll(".wcard").forEach(function (c) { c.classList.remove("on"); });
    card.classList.add("on");
    group.classList.remove("nudge");
    state[f] = card.getAttribute("data-v"); save();
    if (group.getAttribute("data-auto") && current < TOTAL) {
      setTimeout(function () { current++; render(); }, 260);
    }
  });

  function bind(el, f) {
    if (!el) return;
    el.addEventListener("input", function () {
      state[f] = el.value; save();
      if (f === "email" || f === "name") errBox.style.display = "none";
    });
  }
  bind(msg, "message"); bind(nameI, "name"); bind(emailI, "email"); bind(phoneI, "phone");

  // ── Inspiration photos ────────────────────────────────────────────────────
  // Resized in the browser (longest side 1600px, JPEG) so a phone photo
  // uploads in a moment; the bare bytes go to /inquiry/image, which stores
  // them and returns the public URL that rides along with the request.
  function showUpErr(text) {
    if (!upErr) return;
    upErr.textContent = text; upErr.hidden = !text;
  }

  function renderThumbs() {
    if (!thumbs) return;
    thumbs.querySelectorAll(".wup-thumb:not(.up)").forEach(function (t) { t.remove(); });
    state.images.forEach(function (u) {
      var t = document.createElement("div");
      t.className = "wup-thumb";
      t.innerHTML = '<img src="' + u + '" alt="Inspiration photo"><button type="button" class="wup-x" aria-label="Remove photo">×</button>';
      t.querySelector(".wup-x").addEventListener("click", function () {
        state.images = state.images.filter(function (x) { return x !== u; });
        save(); renderThumbs(); showUpErr("");
      });
      thumbs.appendChild(t);
    });
    if (addBtn) addBtn.style.display = state.images.length + uploading >= MAX_IMAGES ? "none" : "";
  }

  function loadBitmap(file) {
    return createImageBitmap(file, { imageOrientation: "from-image" })
      .catch(function () { return createImageBitmap(file); });
  }

  function resizeToJpeg(file) {
    return loadBitmap(file).then(function (bmp) {
      var s = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
      var c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(bmp.width * s));
      c.height = Math.max(1, Math.round(bmp.height * s));
      c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
      if (bmp.close) bmp.close();
      return new Promise(function (resolve, reject) {
        c.toBlob(function (b) { b ? resolve(b) : reject(new Error("encode")); }, "image/jpeg", 0.85);
      });
    });
  }

  function addFiles(files) {
    showUpErr("");
    [].slice.call(files).forEach(function (file) {
      if (state.images.length + uploading >= MAX_IMAGES) { showUpErr("Five photos is the limit — remove one to add another."); return; }
      if (file.size > 30 * 1024 * 1024) { showUpErr("That photo is too large."); return; }
      uploading++;
      var ph = document.createElement("div");
      ph.className = "wup-thumb up";
      if (thumbs) thumbs.appendChild(ph);
      if (addBtn && state.images.length + uploading >= MAX_IMAGES) addBtn.style.display = "none";
      resizeToJpeg(file)
        .then(function (blob) {
          return fetch("/inquiry/image", { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: blob })
            .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); });
        })
        .then(function (res) {
          if (!res.ok || !res.j.url) throw new Error(res.j.error || "upload");
          state.images.push(res.j.url); save();
        })
        .catch(function (err) {
          showUpErr(err && err.message && err.message !== "upload" && err.message !== "encode"
            ? "That photo didn't upload — a JPG, PNG or screenshot works best."
            : "That photo didn't upload — please try again.");
        })
        .then(function () { uploading--; ph.remove(); renderThumbs(); });
    });
  }

  if (addBtn && fileI) {
    addBtn.addEventListener("click", function () { fileI.click(); });
    fileI.addEventListener("change", function () { addFiles(fileI.files); fileI.value = ""; });
    var zone = document.getElementById("wizUpload");
    zone.addEventListener("dragover", function (e) { e.preventDefault(); zone.classList.add("drag"); });
    zone.addEventListener("dragleave", function () { zone.classList.remove("drag"); });
    zone.addEventListener("drop", function (e) {
      e.preventDefault(); zone.classList.remove("drag");
      if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
    });
    renderThumbs();
  }

  function submit() {
    ["type", "metal", "stone", "budget", "timeline", "message", "name", "email", "phone"].forEach(function (k) {
      form.elements[k].value = state[k] || "";
    });
    form.elements.images.value = JSON.stringify(state.images.slice(0, MAX_IMAGES));
    // Answers stay saved until thanks.html, so backing out of the Stripe
    // checkout returns to a filled-in wizard. pendingAt flags a brief that went
    // to checkout — if the tab closed after paying, the next visit says so.
    state.pendingAt = Date.now(); save();
    errBox.style.display = "none";
    nextBtn.disabled = true; // one checkout per click
    form.submit();
  }

  nextBtn.addEventListener("click", function () {
    if (current === 1 && !state.type) {
      var g = wizard.querySelector('.wiz-cards[data-field="type"]');
      g.classList.add("nudge");
      setTimeout(function () { g.classList.remove("nudge"); }, 600);
      return;
    }
    if (current === TOTAL) {
      if (!state.name.trim() || !validEmail(state.email.trim())) { errBox.textContent = errText; errBox.style.display = "block"; return; }
      if (uploading) { errBox.textContent = "One moment — your photos are still uploading."; errBox.style.display = "block"; return; }
      submit(); return;
    }
    current++; render();
  });
  backBtn.addEventListener("click", function () { if (current > 1) { current--; render(); } });
  // Back from Stripe can restore this page from the back-forward cache.
  window.addEventListener("pageshow", function () { nextBtn.disabled = false; });

  // server bounced (invalid email) → jump to contact and show the error;
  // back from the design-fee checkout unpaid → same step, saying so
  var q = new URLSearchParams(location.search);
  if (q.get("error")) current = TOTAL;
  var feeMsg = q.get("fee") === "cancelled"
    ? "Your payment wasn't completed, so your request hasn't been sent yet. You can pay and send it below."
    : q.get("error") === "payment"
    ? "We couldn't open the payment page. Please try again in a moment, or write to us at hello@azoir.co."
    : q.get("error") === "busy"
    ? "Please wait a few minutes, then pay and send your request again."
    : q.get("error") ? errText
    : state.pendingAt
    ? "Already paid the design fee? Then your request was sent — please check your inbox for our confirmation before paying again."
    : "";
  if (q.get("fee") || q.get("error")) delete state.pendingAt; // back from checkout unpaid
  if (feeMsg) { current = TOTAL; errBox.textContent = feeMsg; errBox.style.display = "block"; }
  // ?piece= from the home page's links: pick that piece and open at step 2
  var piece = q.get("piece");
  var typeCards = [].slice.call(wizard.querySelectorAll('.wiz-cards[data-field="type"] .wcard'));
  if (piece && !feeMsg && typeCards.some(function (c) { return c.getAttribute("data-v") === piece; })) {
    typeCards.forEach(function (c) { c.classList.toggle("on", c.getAttribute("data-v") === piece); });
    state.type = piece; current = 2;
  }
  // Drop the notice (and ?piece) from the URL, so a later visit (history, Back from thanks)
  // doesn't tell a customer who has since paid that their payment failed.
  // Other params (utm_*, gclid) stay for analytics.
  if (q.has("fee") || q.has("error") || q.has("piece")) {
    q.delete("fee"); q.delete("error"); q.delete("piece");
    var rest = q.toString();
    try { history.replaceState(null, "", location.pathname + (rest ? "?" + rest : "") + location.hash); } catch (e) {}
  }

  render();
})();
