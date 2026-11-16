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

  // More reviews than fit in a row: a swipeable strip with prev/next arrows.
  function carousel(box) {
    box.classList.add("is-carousel");
    box.tabIndex = 0;
    box.setAttribute("role", "region");
    box.setAttribute("aria-label", "Client reviews");
    var calm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var nav = document.createElement("div");
    nav.className = "rev-nav";
    var prev = arrow("Previous review", "M19 12H5M11 6l-6 6 6 6", -1);
    var next = arrow("Next review", "M5 12h14M13 6l6 6-6 6", 1);
    nav.appendChild(prev);
    nav.appendChild(next);
    box.parentNode.insertBefore(nav, box.nextSibling);

    function arrow(label, d, dir) {
      var b = document.createElement("button");
      b.type = "button";
      b.setAttribute("aria-label", label);
      b.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" aria-hidden="true"><path d="' + d + '"/></svg>';
      b.addEventListener("click", function () {
        var card = box.querySelector(".rev-card");
        var gap = parseFloat(getComputedStyle(box).columnGap) || 0;
        box.scrollBy({ left: dir * (card.offsetWidth + gap), behavior: calm ? "auto" : "smooth" });
      });
      return b;
    }
    function sync() {
      prev.disabled = box.scrollLeft <= 2;
      next.disabled = box.scrollLeft + box.clientWidth >= box.scrollWidth - 2;
    }
    box.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);
    sync();
  }
})();
