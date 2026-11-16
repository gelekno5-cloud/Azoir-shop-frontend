// Azoir & Co. — client reviews. Fills every <section data-reviews="…"> on the
// page from /reviews.json and un-hides it. No reviews for a slot = the section
// stays hidden, so an empty file shows nothing anywhere.
//
// Only real clients' words, quoted with their permission. One entry:
//   { "quote": "…", "name": "Sarah", "piece": "Emerald engagement ring",
//     "pages": ["home", "engagement"] }        // omit "pages" = every slot
// Slots: home · commission · engagement · bands. A slot shows up to data-max
// (default 3); a .rev-list with data-carousel becomes a slowly gliding text
// strip once it has more than 3 (home: up to 5).
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

  // More reviews than fit in a row: a text strip that glides forward slowly
  // and endlessly (a second, hidden copy follows the first, so the loop has no
  // jump). Stops while hovered or touched, off screen or in a hidden
  // tab. Reduced motion: no movement, the strip can be swiped instead.
  function carousel(box) {
    var calm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var view = document.createElement("div");
    view.className = "rev-viewport" + (calm ? " is-still" : "");
    view.setAttribute("role", "region");
    view.setAttribute("aria-label", "Client reviews");
    box.parentNode.insertBefore(view, box);
    view.appendChild(box);
    box.classList.add("is-carousel");
    if (calm) return;

    var cards = Array.prototype.slice.call(box.children);
    cards.forEach(function (c) {
      var copy = c.cloneNode(true);
      copy.setAttribute("aria-hidden", "true");
      box.appendChild(copy);
    });
    var x = 0, last = 0, raf = 0, held = false, onScreen = false;
    function loopWidth() { return box.children[cards.length].offsetLeft - cards[0].offsetLeft; }
    function speed() { return view.clientWidth < 600 ? 12 : 24; } // px per second
    function frame(t) {
      var dt = last ? Math.min(t - last, 100) : 0;
      last = t;
      var w = loopWidth();
      x -= speed() * dt / 1000;
      if (w > 0 && -x >= w) x += w;
      box.style.transform = "translate3d(" + x.toFixed(2) + "px,0,0)";
      raf = requestAnimationFrame(frame);
    }
    function update() {
      var run = !held && onScreen && !document.hidden;
      if (run && !raf) { last = 0; raf = requestAnimationFrame(frame); }
      if (!run && raf) { cancelAnimationFrame(raf); raf = 0; }
    }
    function hold(on) { return function () { held = on; update(); }; }
    view.addEventListener("mouseenter", hold(true));
    view.addEventListener("mouseleave", hold(false));
    view.addEventListener("touchstart", hold(true), { passive: true });
    view.addEventListener("touchend", hold(false));
    view.addEventListener("touchcancel", hold(false));
    document.addEventListener("visibilitychange", update);
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (es) { onScreen = es[0].isIntersecting; update(); }).observe(view);
    } else { onScreen = true; update(); }
  }
})();
