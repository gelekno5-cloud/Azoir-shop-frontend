/* Home hero carousel: each slide is a campaign film. When a film ends the
   hero crossfades to the next one, which also hides the jump a hard loop
   would make on the push-in. Reduced motion keeps the posters and only
   changes slide on a dot. A film with data-end moves on at that second
   instead of at its end (the bands clip pushes in past the rings). */
(function () {
  var hero = document.querySelector(".hero-film");
  if (!hero) return;
  var slides = [].slice.call(hero.querySelectorAll(".film"));
  var dots = [].slice.call(hero.querySelectorAll(".film-dot"));
  var pauseBtn = hero.querySelector(".film-pause");
  var still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var FADE_MS = 900;      // keep in step with .film's opacity transition
  var FALLBACK_MS = 12000; // advance even if a film never plays (autoplay blocked)
  var current = 0, paused = still, timer = 0;

  function video(i) { return slides[i].querySelector(".film-media"); }

  function play(v) {
    v.muted = true; // required for programmatic autoplay
    var p = v.play();
    if (p && p.catch) p.catch(function () {});
  }

  function arm() {
    clearTimeout(timer);
    if (!paused) timer = setTimeout(next, FALLBACK_MS);
  }

  function show(i) {
    if (i === current) return;
    var prev = current;
    current = i;
    var v = video(i);
    v.currentTime = 0;
    if (!paused) play(v);
    slides.forEach(function (s, k) {
      s.classList.toggle("is-active", k === i);
      s.toggleAttribute("inert", k !== i);
      if (k === i) s.removeAttribute("aria-hidden"); else s.setAttribute("aria-hidden", "true");
    });
    dots.forEach(function (d, k) {
      if (k === i) d.setAttribute("aria-current", "true"); else d.removeAttribute("aria-current");
    });
    setTimeout(function () { if (current !== prev) video(prev).pause(); }, FADE_MS);
    arm();
  }

  function next() { show((current + 1) % slides.length); }

  slides.forEach(function (s, k) {
    // once a film is really playing, its "ended" drives the carousel
    video(k).addEventListener("playing", function () { if (k === current) clearTimeout(timer); });
    video(k).addEventListener("ended", function () {
      if (k === current && !paused) next();
    });
    var end = parseFloat(video(k).dataset.end);
    if (end) video(k).addEventListener("timeupdate", function () {
      if (video(k).currentTime < end) return;
      video(k).pause();
      if (k === current && !paused) next();
    });
  });

  dots.forEach(function (d, k) { d.addEventListener("click", function () { show(k); }); });

  if (pauseBtn) pauseBtn.addEventListener("click", function () {
    paused = !paused;
    pauseBtn.setAttribute("aria-pressed", paused ? "true" : "false");
    pauseBtn.setAttribute("aria-label", paused ? "Play" : "Pause");
    if (paused) { clearTimeout(timer); video(current).pause(); }
    else {
      var v = video(current), end = parseFloat(v.dataset.end);
      if (v.ended || (end && v.currentTime >= end)) next(); else { play(v); arm(); }
    }
  });

  // Swipe between slides on touch screens
  var x0 = null;
  hero.addEventListener("touchstart", function (e) { x0 = e.touches[0].clientX; }, { passive: true });
  hero.addEventListener("touchend", function (e) {
    if (x0 === null) return;
    var dx = e.changedTouches[0].clientX - x0;
    x0 = null;
    if (Math.abs(dx) > 50) show((current + (dx < 0 ? 1 : slides.length - 1)) % slides.length);
  }, { passive: true });

  if (still) return;
  play(video(0));
  arm();
  // Fetch the next films once the page has settled
  window.addEventListener("load", function () {
    slides.forEach(function (s, k) { if (k) video(k).preload = "auto"; });
  });

  // Fallback for Safari/iOS settings that block autoplay: start on first interaction
  function kick() {
    var v = video(current);
    if (!paused && v.paused && !v.ended) play(v);
  }
  ["pointerdown", "touchstart", "scroll", "keydown"].forEach(function (ev) {
    window.addEventListener(ev, kick, { passive: true, once: true });
  });
})();
