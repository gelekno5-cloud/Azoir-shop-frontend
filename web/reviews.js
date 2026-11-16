// Azoir & Co. — client reviews. Fills every <section data-reviews="…"> on the
// page from /reviews.json and un-hides it. No reviews for a slot = the section
// stays hidden, so an empty file shows nothing anywhere.
//
// Only real clients' words, quoted with their permission. One entry:
//   { "quote": "…", "name": "Sarah", "piece": "Emerald engagement ring",
//     "pages": ["home", "engagement"] }        // omit "pages" = every slot
// Slots: home · commission · engagement · bands
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
          fig.className = "rev";
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
      });
    })
    .catch(function () { /* no reviews shown — the page is complete without them */ });
})();
