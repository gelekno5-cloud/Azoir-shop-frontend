// Azoir & Co. — concierge widget. One script tag per page; it injects its own
// stylesheet (/concierge.css), draws a launcher and a chat panel, and talks to
// POST /api/concierge. Replies are rendered via textContent only — whitelisted
// site paths and hello@azoir.co are then turned into anchors, nothing else.
(function () {
  "use strict";
  if (window.__azoirConcierge) return;
  window.__azoirConcierge = true;

  var WELCOME = "Welcome. Ask about sizing, materials, timelines, or care — or anything from our guides.";
  var AWAY = "Our concierge is away from the desk — email hello@azoir.co and a designer will reply within one business day.";
  var EMAIL = "hello@azoir.co";
  var PATHS = ["/commission.html", "/wedding-bands.html", "/ring-size.html", "/materials.html",
    "/care.html", "/shipping.html", "/faq.html", "/how.html", "/gallery.html"];
  // Exact matches only: the longest token wins at each position.
  var LINK_RE = /(\/(?:commission|wedding-bands|ring-size|materials|care|shipping|faq|how|gallery)\.html|hello@azoir\.co)/g;
  var KEY_HIST = "cz.history", KEY_OPEN = "cz.open";

  // sessionStorage can be unavailable (privacy modes) — degrade to in-memory.
  var mem = {};
  function sget(k) { try { return sessionStorage.getItem(k); } catch (e) { return mem[k] || null; } }
  function sset(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { mem[k] = v; } }

  function loadHistory() {
    try {
      var h = JSON.parse(sget(KEY_HIST) || "[]");
      if (!Array.isArray(h)) return [];
      return h.filter(function (t) {
        return t && (t.role === "user" || t.role === "assistant") && typeof t.content === "string";
      });
    } catch (e) { return []; }
  }

  var history = loadHistory();
  var busy = false;

  // ── Mount ──────────────────────────────────────────────────────────────────
  var link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "/concierge.css";
  document.head.appendChild(link);

  var root = document.createElement("div");
  root.className = "cz-root";
  // The band builder keeps its own sticky deposit bar at the bottom of the
  // viewport — raise the launcher clear of it on that page.
  var p = location.pathname.replace(/\/+$/, "");
  if (p === "/wedding-bands.html" || p === "/wedding-bands") root.className += " cz-raise";

  var launcher = document.createElement("button");
  launcher.type = "button";
  launcher.className = "cz-launch";
  launcher.textContent = "Concierge";
  launcher.setAttribute("aria-haspopup", "dialog");

  var panel = document.createElement("section");
  panel.className = "cz-panel";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Concierge");
  panel.innerHTML =
    '<header class="cz-head"><div class="cz-head-text">' +
    '<h2 class="cz-title">Concierge</h2>' +
    '<p class="cz-sub">Instant answers from our guides. Every commission is handled personally by a designer.</p>' +
    "</div>" +
    '<button type="button" class="cz-close" aria-label="Close">&times;</button></header>' +
    '<div class="cz-log" role="log" aria-live="polite"></div>' +
    '<form class="cz-form">' +
    '<input class="cz-input" type="text" maxlength="1000" autocomplete="off" placeholder="Ask a question" aria-label="Your question">' +
    '<button type="submit" class="cz-send">Send</button>' +
    "</form>" +
    '<p class="cz-foot">Prefer a person? <a href="mailto:hello@azoir.co">hello@azoir.co</a></p>';

  root.appendChild(panel);
  root.appendChild(launcher);
  document.body.appendChild(root);

  var log = panel.querySelector(".cz-log");
  var form = panel.querySelector(".cz-form");
  var input = panel.querySelector(".cz-input");
  var sendBtn = panel.querySelector(".cz-send");

  // ── Rendering ──────────────────────────────────────────────────────────────
  function linkify(el, text) {
    var parts = String(text).split(LINK_RE);
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i];
      if (!part) continue;
      if (part === EMAIL) {
        var m = document.createElement("a");
        m.href = "mailto:" + EMAIL;
        m.textContent = EMAIL;
        el.appendChild(m);
      } else if (PATHS.indexOf(part) !== -1) {
        var a = document.createElement("a");
        a.href = part; // same-tab navigation
        a.textContent = part;
        el.appendChild(a);
      } else {
        el.appendChild(document.createTextNode(part));
      }
    }
  }

  function bubble(role, text, animate) {
    var b = document.createElement("div");
    b.className = "cz-msg " + (role === "user" ? "cz-user" : "cz-bot") + (animate ? " cz-in" : "");
    if (role === "user") b.textContent = text;
    else linkify(b, text);
    log.appendChild(b);
    log.scrollTop = log.scrollHeight;
    return b;
  }

  function renderAll() {
    while (log.firstChild) log.removeChild(log.firstChild);
    bubble("assistant", WELCOME); // fixed client-side welcome, never sent to the API
    for (var i = 0; i < history.length; i++) bubble(history[i].role, history[i].content);
  }

  var thinkEl = null;
  function showThinking() {
    thinkEl = document.createElement("div");
    thinkEl.className = "cz-msg cz-bot cz-think cz-in";
    thinkEl.setAttribute("aria-label", "Thinking");
    thinkEl.innerHTML = "<span></span><span></span><span></span>";
    log.appendChild(thinkEl);
    log.scrollTop = log.scrollHeight;
  }
  function hideThinking() {
    if (thinkEl && thinkEl.parentNode) thinkEl.parentNode.removeChild(thinkEl);
    thinkEl = null;
  }

  // ── Open / close ───────────────────────────────────────────────────────────
  function isOpen() { return panel.classList.contains("cz-open"); }
  function openPanel(fromUser, instant) {
    panel.hidden = false; // the [hidden] guard only matters before the stylesheet loads
    sset(KEY_OPEN, "1");
    renderAll();
    // A forced reflow commits the current styles before the class flips, so the
    // transition has a start state — synchronous, and unlike rAF it also runs
    // in background tabs (rAF is suspended there).
    if (instant) {
      // Mid-conversation navigation: the panel was open on the previous page,
      // so it reappears without replaying the entrance.
      panel.classList.add("cz-instant", "cz-open");
      void panel.offsetWidth;
      panel.classList.remove("cz-instant");
    } else {
      void panel.offsetWidth;
      panel.classList.add("cz-open");
    }
    // A programmatic focus during the auto-reopen on navigation can raise the
    // keyboard or scroll the page on mobile — focus only on a user gesture.
    if (fromUser) input.focus();
  }
  function closePanel() {
    panel.classList.remove("cz-open"); // the 150ms exit plays; visibility flips after it
    sset(KEY_OPEN, "0");
  }
  launcher.addEventListener("click", function () {
    if (isOpen()) closePanel(); else openPanel(true);
  });
  panel.querySelector(".cz-close").addEventListener("click", closePanel);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && isOpen()) closePanel();
  });

  // ── Send ───────────────────────────────────────────────────────────────────
  function setBusy(on) {
    busy = on;
    sendBtn.disabled = on;
    input.disabled = on;
  }

  function finish(reply) {
    hideThinking();
    history.push({ role: "assistant", content: reply });
    sset(KEY_HIST, JSON.stringify(history));
    bubble("assistant", reply, true);
    setBusy(false);
    if (isOpen()) input.focus();
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (busy) return;
    var text = input.value.trim().slice(0, 1000);
    if (!text) return;
    var prior = history.slice(-10); // context sent with the question
    history.push({ role: "user", content: text });
    sset(KEY_HIST, JSON.stringify(history));
    bubble("user", text, true);
    input.value = "";
    setBusy(true);
    showThinking();
    fetch("/api/concierge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: text, history: prior }),
    })
      .then(function (r) { if (!r.ok) throw new Error("http " + r.status); return r.json(); })
      .then(function (d) {
        finish(d && typeof d.reply === "string" && d.reply ? d.reply : AWAY);
      })
      .catch(function () { finish(AWAY); });
  });

  // Reopen if it was open on the previous page.
  if (sget(KEY_OPEN) === "1") openPanel(false, true);
})();
