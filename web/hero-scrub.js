/* Scroll-driven hero: pins the hero and scrubs the sketch→render
   frame sequence (media/seq/f001–f070.webp) as the user scrolls. */
(function () {
  var FRAMES = 70;
  var SCRUB_VH = 1.6; // extra scroll distance driving the scrub, in viewport-heights

  var wrap = document.getElementById("heroScroll");
  var hero = wrap && wrap.querySelector(".hero");
  var canvas = document.getElementById("heroCanvas");
  if (!wrap || !hero || !canvas || !canvas.getContext) return;

  // Nav is transparent over the hero (body.nav-clear); solid once past it
  var nav = document.querySelector("nav");
  function navState() {
    if (nav) nav.classList.toggle("solid", wrap.getBoundingClientRect().bottom <= window.innerHeight * 0.5);
  }
  navState();
  window.addEventListener("scroll", navState, { passive: true });

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  var ctx = canvas.getContext("2d");
  var imgs = new Array(FRAMES);
  var loaded = new Array(FRAMES);
  var current = -1;

  function src(i) {
    return "media/seq/f" + String(i + 1).padStart(3, "0") + ".webp";
  }

  // Nearest already-loaded frame so scrubbing never shows a blank canvas
  function nearestLoaded(i) {
    for (var d = 0; d < FRAMES; d++) {
      if (loaded[i - d]) return i - d;
      if (loaded[i + d]) return i + d;
    }
    return -1;
  }

  function draw(i) {
    var j = nearestLoaded(i);
    if (j < 0 || j === current) return;
    current = j;
    ctx.drawImage(imgs[j], 0, 0, canvas.width, canvas.height);
  }

  function progress() {
    var rect = wrap.getBoundingClientRect();
    var vh = window.innerHeight;
    var heroH = hero.offsetHeight;
    var travel = wrap.offsetHeight - heroH; // sticky travel = scrub distance
    var start = Math.max(0, heroH - vh); // scrolled past wrap top before pin engages
    var p = (-rect.top - start) / travel;
    return Math.max(0, Math.min(1, p));
  }

  var ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      draw(Math.round(progress() * (FRAMES - 1)));
    });
  }

  function layout() {
    var vh = window.innerHeight;
    var heroH = hero.offsetHeight;
    wrap.style.height = heroH + vh * SCRUB_VH + "px";
    hero.style.top = Math.min(0, vh - heroH) + "px";
    onScroll();
  }

  // First frame activates the canvas; the rest stream in behind it
  var first = new Image();
  first.onload = function () {
    imgs[0] = first;
    loaded[0] = true;
    document.body.classList.add("scrub");
    layout();
    for (var i = 1; i < FRAMES; i++) {
      (function (i) {
        var im = new Image();
        im.onload = function () {
          imgs[i] = im;
          loaded[i] = true;
          if (current !== -1) onScroll();
        };
        im.src = src(i);
      })(i);
    }
  };
  first.src = src(0);

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", layout);
})();
