/* Announcements + sign-up pop-up, set in the Moksh Diam admin (Announcements, Sign-up pop-up).
   GET /api/promos → top-bar messages (every page), homepage banners, and the pop-up.
   POST /api/signup → the pop-up's sign-up. Dismissals and sign-ups are remembered in localStorage. */
(function () {
  'use strict';
  var DISMISSED = 'azoir_promo_dismissed', POPUP = 'azoir_popup';
  var store = {
    get: function (k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var safeUrl = function (u) { return /^(https:\/\/|\/)/.test(String(u || '')) ? u : null; };
  var isHome = location.pathname === '/' || location.pathname === '/index.html';

  var css =
    ':root{--promo-h:0px}nav{top:var(--promo-h)!important}body{padding-top:var(--promo-h)}' +
    '.promo-bar{position:fixed;top:0;left:0;right:0;z-index:61;font:500 12px/1.4 Inter,system-ui,sans-serif;letter-spacing:.04em;text-align:center}' +
    '.promo-bar .pb-in{position:relative;padding:9px 44px;min-height:36px;display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap}' +
    '.promo-dark{background:#242522;color:#FAF9F6}.promo-light{background:#F1EEE8;color:#242522;border-bottom:1px solid #DDD8D0}.promo-accent{background:#682F3B;color:#fff}' +
    '.promo-bar a{color:inherit;text-decoration:underline;text-underline-offset:3px}' +
    '.promo-code{font:600 11.5px/1 ui-monospace,Menlo,monospace;letter-spacing:.12em;border:1px solid currentColor;background:transparent;color:inherit;padding:5px 8px;cursor:pointer;border-radius:0}' +
    '.promo-x{position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:0;color:inherit;font-size:18px;line-height:1;padding:6px;cursor:pointer;opacity:.75}' +
    '.promo-x:hover,.promo-x:focus-visible{opacity:1}' +
    '.promo-msg{transition:opacity .25s ease}.promo-msg.fade{opacity:0}' +
    '.promo-banner{margin:0 auto;max-width:1440px;padding:28px clamp(22px,5.5vw,84px);display:flex;align-items:center;justify-content:center;gap:16px;flex-wrap:wrap;text-align:center;font:400 15px/1.5 Inter,system-ui,sans-serif}' +
    '.promo-banner .pbn-msg{font:400 clamp(22px,3vw,30px)/1.2 "Instrument Serif",Georgia,serif}' +
    '.promo-banner .btn-fill,.promo-banner .btn-outline{text-decoration:none}' +
    '.promo-banner-wrap{position:relative}.promo-banner-wrap .promo-x{top:14px;transform:none}' +
    '.promo-pop{position:fixed;inset:0;z-index:200;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(36,37,34,.42)}' +
    '.promo-pop[hidden]{display:none}' +
    '.promo-card{position:relative;width:100%;max-width:440px;max-height:calc(100vh - 32px);overflow:auto;background:#FAF9F6;color:#242522;padding:34px 30px 28px;box-shadow:0 24px 60px rgba(0,0,0,.18)}' +
    '.promo-card h2{font:400 32px/1.1 "Instrument Serif",Georgia,serif;margin:0 0 10px}' +
    '.promo-card p{font-size:14px;line-height:1.6;color:#55554F;margin:0 0 16px}' +
    '.promo-card input,.promo-card select{width:100%;font:inherit;font-size:15px;color:#242522;background:#fff;border:1px solid #CEC8BC;border-radius:0;padding:12px 14px;margin:0 0 10px}' +
    '.promo-card input:focus,.promo-card select:focus{outline:none;border-color:#682F3B}' +
    '.promo-card .pc-consent{display:flex;gap:10px;align-items:flex-start;font-size:12.5px;line-height:1.5;color:#55554F;margin:4px 0 16px}' +
    '.promo-card .pc-consent input{width:auto;margin:3px 0 0}' +
    '.promo-card .btn-fill{width:100%;border:0;cursor:pointer}' +
    '.promo-card .pc-err{color:#A3263A;font-size:13px;margin:10px 0 0}' +
    '.promo-card .pc-code{display:flex;gap:8px;margin:6px 0 16px}.promo-card .pc-code span{flex:1;border:1px dashed #682F3B;padding:12px;text-align:center;font:600 18px/1 ui-monospace,Menlo,monospace;letter-spacing:.18em;color:#242522}' +
    '.promo-card .pc-code button{border:1px solid #CEC8BC;background:#fff;padding:0 14px;cursor:pointer;font-size:12px;letter-spacing:.1em;text-transform:uppercase}' +
    '.promo-card .promo-x{top:12px;right:12px;transform:none;color:#55554F}' +
    '.pc-hp{position:absolute!important;left:-9999px!important;width:1px;height:1px;opacity:0}' +
    '@media(max-width:560px){.promo-bar .pb-in{padding:8px 38px;font-size:11.5px}.promo-card{padding:28px 20px 22px}.promo-card h2{font-size:28px}}' +
    '@media(prefers-reduced-motion:reduce){.promo-msg{transition:none}}';

  function copy(btn, code) {
    var done = function () { var t = btn.textContent; btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = t; }, 1600); };
    if (navigator.clipboard) navigator.clipboard.writeText(code).then(done, done); else done();
  }

  function codeHtml(c) { return c ? '<button type="button" class="promo-code" data-code="' + esc(c.code) + '" aria-label="Copy code ' + esc(c.code) + '">' + esc(c.code) + '</button>' : ''; }
  function linkHtml(l) { var u = l && safeUrl(l.url); return u ? '<a href="' + esc(u) + '">' + esc(l.label || 'Shop now') + '</a>' : ''; }

  function dismissed() { return store.get(DISMISSED) || {}; }
  function dismiss(version) { var d = dismissed(); d[version] = Date.now(); store.set(DISMISSED, d); }

  // ── Top bar: one message at a time, rotating ────────────────────────────────
  function renderBar(list) {
    if (!list.length) return;
    var bar = document.createElement('div');
    bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', 'Announcements');
    document.body.insertBefore(bar, document.body.firstChild);
    var i = 0, timer = 0, paused = false;
    function setH() { document.documentElement.style.setProperty('--promo-h', bar.offsetHeight + 'px'); }
    function show() {
      var a = list[i];
      bar.className = 'promo-bar promo-' + (a.style || 'dark');
      bar.innerHTML = '<div class="pb-in"><span class="promo-msg">' + esc(a.message) + '</span>' + codeHtml(a.code) + linkHtml(a.link) +
        (a.dismissible ? '<button type="button" class="promo-x" aria-label="Close announcement">×</button>' : '') + '</div>';
      setH();
    }
    bar.addEventListener('click', function (e) {
      var c = e.target.closest('[data-code]'); if (c) { copy(c, c.getAttribute('data-code')); return; }
      if (e.target.closest('.promo-x')) {
        dismiss(list[i].version); list.splice(i, 1);
        if (!list.length) { clearInterval(timer); bar.remove(); document.documentElement.style.setProperty('--promo-h', '0px'); return; }
        i = i % list.length; show();
      }
    });
    bar.addEventListener('mouseenter', function () { paused = true; });
    bar.addEventListener('mouseleave', function () { paused = false; });
    bar.addEventListener('focusin', function () { paused = true; });
    bar.addEventListener('focusout', function () { paused = false; });
    show();
    window.addEventListener('resize', setH);
    if (list.length > 1 && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      timer = setInterval(function () { if (!paused && document.visibilityState === 'visible') { i = (i + 1) % list.length; show(); } }, 6000);
    }
  }

  // ── Homepage banners: under the hero ────────────────────────────────────────
  function renderBanners(list) {
    if (!list.length || !isHome) return;
    var anchor = document.getElementById('promoBanner') || document.querySelector('header.hero-film');
    if (!anchor) return;
    list.forEach(function (a) {
      var wrap = document.createElement('div'); // not a <section>: the site pads every section
      wrap.className = 'promo-banner-wrap promo-' + (a.style || 'light');
      wrap.setAttribute('role', 'region'); wrap.setAttribute('aria-label', 'Announcement');
      var u = a.link && safeUrl(a.link.url);
      wrap.innerHTML = '<div class="promo-banner"><span class="pbn-msg">' + esc(a.message) + '</span>' + codeHtml(a.code) +
        (u ? '<a class="' + (a.style === 'light' ? 'btn-fill' : 'btn-outline') + ' sm" style="' + (a.style === 'light' ? '' : 'color:inherit;border-color:currentColor') + '" href="' + esc(u) + '">' + esc(a.link.label || 'Shop now') + '</a>' : '') +
        '</div>' + (a.dismissible ? '<button type="button" class="promo-x" aria-label="Close announcement">×</button>' : '');
      wrap.addEventListener('click', function (e) {
        var c = e.target.closest('[data-code]'); if (c) { copy(c, c.getAttribute('data-code')); return; }
        if (e.target.closest('.promo-x')) { dismiss(a.version); wrap.remove(); }
      });
      anchor.parentNode.insertBefore(wrap, anchor.nextSibling);
      anchor = wrap;
    });
  }

  // ── Sign-up pop-up ──────────────────────────────────────────────────────────
  var FIELD = {
    first_name: '<input name="first_name" autocomplete="given-name" maxlength="80" placeholder="First name" aria-label="First name">',
    last_name: '<input name="last_name" autocomplete="family-name" maxlength="80" placeholder="Last name" aria-label="Last name">',
    phone: '<input name="phone" type="tel" autocomplete="tel" maxlength="40" placeholder="Phone (optional)" aria-label="Phone">',
    birthday: '<input name="birthday" type="text" inputmode="numeric" maxlength="5" placeholder="Birthday (MM-DD)" aria-label="Birthday, month and day" pattern="[0-1][0-9]-[0-3][0-9]">'
  };

  function popupDue(p) {
    if (!p) return false;
    if (p.pages === 'home' && !isHome) return false;
    var s = store.get(POPUP) || {};
    if (s.signedUp) return false;
    if (s.version === p.version && s.closedAt && Date.now() - s.closedAt < p.reshowDays * 864e5) return false;
    return true;
  }

  function renderPopup(p) {
    var root = document.createElement('div');
    root.className = 'promo-pop'; root.hidden = true;
    var fields = (p.fields || []).filter(function (f) { return f !== 'interest' && FIELD[f]; });
    var emailFirst = fields.indexOf('first_name') === -1 && fields.indexOf('last_name') === -1;
    var nameHtml = fields.filter(function (f) { return f === 'first_name' || f === 'last_name'; }).map(function (f) { return FIELD[f]; }).join('');
    var restHtml = fields.filter(function (f) { return f === 'phone' || f === 'birthday'; }).map(function (f) { return FIELD[f]; }).join('');
    var interestHtml = (p.fields || []).indexOf('interest') !== -1 && p.interestOptions.length
      ? '<select name="interest" aria-label="What are you shopping for?"><option value="">What are you shopping for?</option>' + p.interestOptions.map(function (o) { return '<option>' + esc(o) + '</option>'; }).join('') + '</select>' : '';
    root.innerHTML =
      '<div class="promo-card" role="dialog" aria-modal="true" aria-labelledby="pcTitle">' +
      '<button type="button" class="promo-x" aria-label="Close">×</button>' +
      '<div class="pc-form"><h2 id="pcTitle">' + esc(p.title) + '</h2>' + (p.body ? '<p>' + esc(p.body) + '</p>' : '') +
      '<form novalidate>' + (emailFirst ? '' : nameHtml) +
      '<input name="email" type="email" required autocomplete="email" maxlength="254" placeholder="Email" aria-label="Email">' + (emailFirst ? nameHtml : '') + restHtml + interestHtml +
      '<input class="pc-hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">' +
      '<label class="pc-consent"><input type="checkbox" name="consent" required> <span>' + esc(p.consentText) + '</span></label>' +
      '<button class="btn-fill" type="submit">' + esc(p.buttonLabel || 'Sign up') + '</button><p class="pc-err" role="alert" hidden></p></form></div>' +
      '<div class="pc-done" hidden><h2>' + esc(p.successTitle || 'Thank you') + '</h2><div class="pc-offer"></div>' + (p.successBody ? '<p>' + esc(p.successBody) + '</p>' : '') +
      '<button type="button" class="btn-fill pc-close">Continue</button></div></div>';
    document.body.appendChild(root);
    var card = root.querySelector('.promo-card'), form = root.querySelector('form'), err = root.querySelector('.pc-err');
    var openedAt = 0, lastFocus = null;

    function close(remember) {
      root.hidden = true; document.removeEventListener('keydown', onKey);
      if (remember) { var s = store.get(POPUP) || {}; s.version = p.version; s.closedAt = Date.now(); store.set(POPUP, s); }
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }
    function onKey(e) {
      if (e.key === 'Escape') close(true);
      if (e.key === 'Tab') { // keep focus inside the dialog
        var f = card.querySelectorAll('button,input:not(.pc-hp),select,a[href]'), vis = Array.prototype.filter.call(f, function (x) { return x.offsetParent !== null; });
        if (!vis.length) return;
        if (e.shiftKey && document.activeElement === vis[0]) { e.preventDefault(); vis[vis.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === vis[vis.length - 1]) { e.preventDefault(); vis[0].focus(); }
      }
    }
    root.addEventListener('click', function (e) {
      if (e.target === root || e.target.closest('.promo-x') || e.target.closest('.pc-close')) close(!root.querySelector('.pc-done:not([hidden])'));
      var c = e.target.closest('[data-copy]'); if (c) copy(c, c.getAttribute('data-copy'));
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(form), email = String(fd.get('email') || '').trim();
      err.hidden = true;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.textContent = 'Please enter a valid email.'; err.hidden = false; return; }
      if (!form.elements.consent.checked) { err.textContent = 'Please tick the box to agree to receive emails.'; err.hidden = false; return; }
      var bday = String(fd.get('birthday') || '').trim();
      if (bday && !/^\d{2}-\d{2}$/.test(bday)) { err.textContent = 'Birthday as MM-DD, like 05-14.'; err.hidden = false; return; }
      var btn = form.querySelector('button[type=submit]'); btn.disabled = true;
      var body = { popupId: p.id, email: email, consent: true, website: fd.get('website') || '', opened_ms: Date.now() - openedAt };
      ['first_name', 'last_name', 'phone', 'birthday', 'interest'].forEach(function (k) { var v = fd.get(k); if (v) body[k] = String(v).trim(); });
      fetch('/api/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
        .then(function (r) {
          btn.disabled = false;
          if (!r.ok) {
            err.textContent = r.body.error === 'too_many_requests' ? 'Too many tries — please wait a few minutes.' : r.body.error === 'invalid_email' ? 'Please enter a valid email.' : 'Something went wrong — please try again.';
            err.hidden = false; return;
          }
          var s = store.get(POPUP) || {}; s.signedUp = true; s.version = p.version; store.set(POPUP, s);
          var offer = r.body.offer;
          root.querySelector('.pc-offer').innerHTML = offer
            ? '<p>' + esc(offer.offer) + ' — your code (we\'ve emailed it too):</p><div class="pc-code"><span>' + esc(offer.code) + '</span><button type="button" data-copy="' + esc(offer.code) + '">Copy</button></div>'
            : r.body.already && p.hasOffer ? '<p>You\'re already on the list — your welcome code was sent to you before.</p>' : '';
          root.querySelector('.pc-form').hidden = true; root.querySelector('.pc-done').hidden = false;
          var c = root.querySelector('.pc-close'); if (c) c.focus();
        })
        .catch(function () { btn.disabled = false; err.textContent = 'Something went wrong — please try again.'; err.hidden = false; });
    });

    setTimeout(function () {
      if (document.body.classList.contains('nav-open')) return; // don't cover an open mobile menu
      lastFocus = document.activeElement; root.hidden = false; openedAt = Date.now();
      document.addEventListener('keydown', onKey);
      var first = form.querySelector('input:not(.pc-hp)'); if (first) first.focus({ preventScroll: true });
    }, Math.max(0, (p.delaySeconds || 0) * 1000));
  }

  fetch('/api/promos', { credentials: 'same-origin' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) {
      if (!data) return;
      var style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
      var d = dismissed();
      var live = (data.announcements || []).filter(function (a) { return !d[a.version]; });
      renderBar(live.filter(function (a) { return a.placement === 'bar'; }));
      renderBanners(live.filter(function (a) { return a.placement === 'banner'; }));
      if (popupDue(data.popup)) renderPopup(data.popup);
    })
    .catch(function () {});
})();
