// Azoir & Co. — client reviews. Fills every <section data-reviews="…"> on the
// page from /reviews.json and un-hides it. No reviews for a slot = the section
// stays hidden, so an empty file shows nothing anywhere.
//
// Only real clients' words, quoted with their permission. One entry:
//   { "quote": "…", "name": "Sarah", "piece": "Emerald engagement ring",
//     "pages": ["home", "engagement"] }        // omit "pages" = every slot
// Slots: home · commission · engagement · bands. A slot shows up to data-max
// (default 3); a .rev-list with data-carousel becomes a swipe strip with arrows
// once it has more than 3 (home: up to 5).
(function () {
  "use strict";
  var slots = document.querySelectorAll("section[data-reviews]");
  if (!slots.length || !window.fetch) return;

  fetch("/reviews.json", { cache: "no-cache" })
    .then(function (r) { return r.ok ? r.json() : { reviews: [] }; })
    .then(function (data) {
      var all = (data && Array.isArray(data.reviews) ? data.reviews : []).filter(function (r) {
        return r && typeof r.quote === "string" && r.quote.trim() && typeof r.name === "string" && r.name.trim();
      });
      slots.forEach(function (sec) {
        var slot = sec.getAttribute("data-reviews");
        var max = parseInt(sec.getAttribute("data-max") || "3", 10);
        var list = all.filter(function (r) {
          return !Array.isArray(r.pages) || r.pages.indexOf(slot) !== -1;
        }).slice(0, max);
        var box = sec.querySelector(".rev-list");
        if (!list.length || !box) return;
        list.forEach(function (r) {
          var fig = document.createElement("figure");
          fig.className = "rev-card";
          var q = document.createElement("blockquote");
          q.textContent = "“" + r.quote.trim() + "”";
          var c = document.createElement("figcaption");
          var b = document.createElement("b");
          b.textContent = r.name.trim();
          c.appendChild(b);
          if (typeof r.piece === "string" && r.piece.trim()) c.appendChild(document.createTextNode(r.piece.trim()));
          fig.appendChild(q);
          fig.appendChild(c);
          box.appendChild(fig);
        });
        box.setAttribute("data-count", String(list.length));
        sec.hidden = false;
        if (box.hasAttribute("data-carousel") && list.length > 3) carousel(box);
      });
    })
    .catch(function () { /* no reviews shown — the page is complete without them */ });

  // More reviews than fit in a row: a text strip that moves on by itself one
  // review at a time (8s when three show, 12s when one shows — time to read),
  // back to the start after the last. Arrows, a pause button, and it holds
  // while hovered/focused, off screen or in a hidden tab. Reduced motion: no
  // auto-advance, arrows only.
  function carousel(box) {
    box.classList.add("is-carousel");
    box.tabIndex = 0;
    box.setAttribute("role", "region");
    box.setAttribute("aria-label", "Client reviews");
    var calm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var sec = box.closest("section") || box.parentNode;
    var nav = document.createElement("div");
    nav.className = "rev-nav";
    var prev = button("Previous review", '<path d="M19 12H5M11 6l-6 6 6 6"/>', function () { go(-1); });
    var next = button("Next review", '<path d="M5 12h14M13 6l6 6-6 6"/>', function () { go(1); });
    var PAUSE = '<path d="M9 6v12M15 6v12"/>', PLAY = '<path d="M8 5.5v13l11-6.5z"/>';
    var stopped = calm, hovering = false, onScreen = false, timer = null;
    nav.appendChild(prev);
    if (!calm) {
      var pause = button("Pause reviews", PAUSE, function () {
        stopped = !stopped;
        pause.setAttribute("aria-label", stopped ? "Play reviews" : "Pause reviews");
        pause.firstChild.innerHTML = stopped ? PLAY : PAUSE;
        schedule();
      });
      nav.appendChild(pause);
    }
    nav.appendChild(next);
    box.parentNode.insertBefore(nav, box.nextSibling);

    function button(label, icon, onClick) {
      var b = document.createElement("button");
      b.type = "button";
      b.setAttribute("aria-label", label);
      b.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" aria-hidden="true">' + icon + "</svg>";
      b.addEventListener("click", onClick);
      return b;
    }
    function stepWidth() {
      var card = box.querySelector(".rev-card");
      return card.offsetWidth + (parseFloat(getComputedStyle(box).columnGap) || 0);
    }
    function atEnd() { return box.scrollLeft + box.clientWidth >= box.scrollWidth - 2; }
    function go(dir) {
      box.scrollBy({ left: dir * stepWidth(), behavior: calm ? "auto" : "smooth" });
      schedule();
    }
    function advance() {
      if (atEnd()) box.scrollTo({ left: 0, behavior: "smooth" });
      else box.scrollBy({ left: stepWidth(), behavior: "smooth" });
      schedule();
    }
    function schedule() {
      clearTimeout(timer);
      if (stopped || hovering || !onScreen || document.hidden) return;
      var oneAtATime = box.clientWidth < stepWidth() * 1.5;
      timer = setTimeout(advance, oneAtATime ? 12000 : 8000);
    }
    function sync() {
      prev.disabled = box.scrollLeft <= 2;
      next.disabled = atEnd();
    }
    function hold(on) { return function () { hovering = on; schedule(); }; }
    sec.addEventListener("mouseenter", hold(true));
    sec.addEventListener("mouseleave", hold(false));
    sec.addEventListener("focusin", hold(true));
    sec.addEventListener("focusout", function (e) { if (!sec.contains(e.relatedTarget)) hold(false)(); });
    box.addEventListener("pointerdown", schedule); // a swipe restarts the wait
    document.addEventListener("visibilitychange", schedule);
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (es) { onScreen = es[0].isIntersecting; schedule(); }, { threshold: 0.4 }).observe(box);
    } else { onScreen = true; schedule(); }
    box.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);
    sync();
  }
})();
