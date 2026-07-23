// Make gallery videos autoplay-loop reliably across browsers/devices.
// 1) play each muted clip when it scrolls into view, pause when it leaves
// 2) fall back to starting playback on the first real user interaction,
//    which covers Safari/iOS settings that ignore attribute autoplay.
(function () {
  var vids = document.querySelectorAll(".gallery video");
  if (!vids.length) return;

  function play(v) {
    v.muted = true; // required for programmatic autoplay
    var p = v.play();
    if (p && p.catch) p.catch(function () {});
  }

  var io = ("IntersectionObserver" in window)
    ? new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) play(e.target);
          else e.target.pause();
        });
      }, { threshold: 0.2 })
    : null;

  Array.prototype.forEach.call(vids, function (v) {
    v.muted = true;
    if (io) io.observe(v); else play(v);
  });

  // Fallback: on the first genuine interaction, start any on-screen clip.
  function kick() {
    Array.prototype.forEach.call(vids, function (v) {
      var r = v.getBoundingClientRect();
      if (r.top < window.innerHeight && r.bottom > 0) play(v);
    });
  }
  ["pointerdown", "touchstart", "scroll", "keydown"].forEach(function (ev) {
    window.addEventListener(ev, kick, { passive: true });
  });
})();
