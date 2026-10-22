/* Home hero film: loops with a soft fade through the wall grey, because the
   clip is a push-in and a hard loop would jump from the close-up back to the
   wide shot. Reduced motion keeps the poster. */
(function () {
  var v = document.querySelector(".film-media");
  if (!v || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  var FADE_S = 0.8; // keep in step with .film-media's opacity transition

  function play() {
    v.muted = true; // required for programmatic autoplay
    var p = v.play();
    if (p && p.catch) p.catch(function () {});
  }

  // Fade out just before the end, restart at frame one, fade back in once it's there
  v.addEventListener("timeupdate", function () {
    if (v.duration && v.duration - v.currentTime < FADE_S + 0.1) v.classList.add("fading");
  });
  v.addEventListener("ended", function () {
    v.addEventListener("seeked", function () { v.classList.remove("fading"); }, { once: true });
    v.currentTime = 0;
    play();
  });
  play();

  // Fallback for Safari/iOS settings that block autoplay: start on first interaction
  function kick() {
    if (v.paused && !v.ended && v.currentTime === 0) play();
  }
  ["pointerdown", "touchstart", "scroll", "keydown"].forEach(function (ev) {
    window.addEventListener(ev, kick, { passive: true, once: true });
  });
})();
