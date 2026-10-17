/* Mobile menu: toggles nav.open below 900px. Closes on link tap, Escape, outside tap. */
(function () {
  var nav = document.querySelector('nav');
  var btn = nav && nav.querySelector('.nav-toggle');
  if (!btn) return;
  var mq = window.matchMedia('(max-width:900px)');

  function set(open) {
    nav.classList.toggle('open', open);
    document.body.classList.toggle('nav-open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  }

  btn.addEventListener('click', function () { set(!nav.classList.contains('open')); });
  nav.querySelector('.navlinks').addEventListener('click', function (e) {
    if (e.target.closest('a')) set(false);
  });
  document.addEventListener('click', function (e) {
    if (nav.classList.contains('open') && !nav.contains(e.target)) set(false);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && nav.classList.contains('open')) { set(false); btn.focus(); }
  });
  (mq.addEventListener ? mq.addEventListener.bind(mq, 'change') : mq.addListener.bind(mq))(function () { set(false); });
})();
