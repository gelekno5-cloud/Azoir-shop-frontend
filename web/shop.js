/* Ready to Ship — fills the listing and the piece page from /shop/api, and runs the piece's
   checkout form (address → shipping + tax → Stripe's payment page). No prices are trusted from
   this script: the server prices everything again when the checkout is created. */
(function () {
  var root = document.querySelector('[data-shop]');
  if (!root) return;
  var mode = root.getAttribute('data-shop');
  var $ = function (id) { return document.getElementById(id); };

  function money(m) {
    if (!m) return '';
    var n = Number(m.amount);
    try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: m.currencyCode || 'USD', minimumFractionDigits: n % 1 ? 2 : 0 }).format(n); }
    catch (e) { return '$' + n.toFixed(2); }
  }
  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    for (var k in attrs || {}) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }
  function getJson(url, opts) {
    return fetch(url, opts).then(function (r) { return r.json().catch(function () { return {}; }).then(function (b) { return { status: r.status, body: b }; }); });
  }
  function post(url, body) {
    return getJson(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }

  /* ── Listing ─────────────────────────────────────────────────────────── */
  if (mode === 'list') {
    var grid = $('rtsGrid'), status = $('rtsStatus'), filters = $('rtsFilters'), empty = $('rtsEmpty');
    var all = [], type = 'All';

    var draw = function () {
      grid.textContent = '';
      all.filter(function (p) { return type === 'All' || p.productType === type; }).forEach(function (p, i) {
        var a = el('a', { class: 'rts-card' + (p.availableForSale ? '' : ' sold'), href: '/ready-to-ship/' + encodeURIComponent(p.handle) });
        var ph = el('div', { class: 'ph' });
        if (p.images && p.images[0]) ph.appendChild(el('img', { src: p.images[0].url, alt: p.images[0].altText || p.title, loading: i < 4 ? 'eager' : 'lazy', decoding: 'async' }));
        if (!p.availableForSale) ph.appendChild(el('span', { class: 'tag' }, 'Sold'));
        a.appendChild(ph);
        a.appendChild(el('h3', null, p.title));
        a.appendChild(el('p', { class: 'meta' }, p.metal || p.productType || ''));
        a.appendChild(el('p', { class: 'price' }, p.availableForSale ? money(p.priceRange && p.priceRange.minVariantPrice) : 'Sold'));
        grid.appendChild(a);
      });
    };

    getJson('/shop/api/products').then(function (r) {
      status.hidden = true;
      all = (r.status === 200 && r.body.products) || [];
      if (r.status !== 200) { status.hidden = false; status.textContent = "We couldn't load the pieces just now. Please try again in a moment."; return; }
      if (!all.length) { empty.hidden = false; return; }
      // In-stock pieces first; sold ones stay at the end.
      all.sort(function (a, b) { return (b.availableForSale ? 1 : 0) - (a.availableForSale ? 1 : 0); });
      var types = all.map(function (p) { return p.productType; }).filter(function (t, i, arr) { return t && arr.indexOf(t) === i; });
      if (types.length > 1) {
        ['All'].concat(types).forEach(function (t) {
          var b = el('button', { type: 'button', role: 'tab', 'aria-selected': t === type ? 'true' : 'false' }, t);
          b.addEventListener('click', function () {
            type = t;
            Array.prototype.forEach.call(filters.children, function (c) { c.setAttribute('aria-selected', c === b ? 'true' : 'false'); });
            draw();
          });
          filters.appendChild(b);
        });
        filters.hidden = false;
      }
      draw();
    }).catch(function () { status.textContent = "We couldn't load the pieces just now. Please try again in a moment."; });
    return;
  }

  /* ── Piece ───────────────────────────────────────────────────────────── */
  if (mode !== 'piece') return;
  var handle = decodeURIComponent(location.pathname.replace(/\/+$/, '').split('/').pop() || '');
  var product = null, variant = null, size = '';

  function pickVariant() {
    var selects = document.querySelectorAll('#pcOptions select[data-option]');
    var want = {};
    Array.prototype.forEach.call(selects, function (s) { want[s.getAttribute('data-option')] = s.value; });
    // A variant matches when every option it carries equals the choice; a size the variants don't
    // carry (one shared stock for all sizes) rides along as `size`.
    variant = product.variants.filter(function (v) {
      return v.selectedOptions.every(function (o) { return want[o.name] === undefined || want[o.name] === o.value; });
    })[0] || product.variants[0];
    var sizeOption = product.options.filter(function (o) { return !variant.selectedOptions.some(function (s) { return s.name === o.name; }); })[0];
    size = sizeOption ? (want[sizeOption.name] || sizeOption.values[0]) : '';
    $('pcPrice').textContent = money(variant.price);
    var cmp = $('pcCompare');
    cmp.hidden = !variant.compareAtPrice;
    cmp.textContent = variant.compareAtPrice ? money(variant.compareAtPrice) : '';
    // Back from Stripe: the piece reads as sold only because this shopper's own checkout still holds
    // it. Checking out again releases that hold first, so keep Buy available.
    var ok = variant.availableForSale || /[?&]cancelled=1/.test(location.search);
    $('pcBuy').hidden = !ok || !$('pcForm').hidden;
    $('pcSold').hidden = ok;
    if (!ok) $('pcForm').hidden = true;
    $('pcTotals').hidden = true;
  }

  function spec(dl, label, value) {
    if (!value) return;
    var row = el('div');
    row.appendChild(el('dt', null, label));
    row.appendChild(el('dd', null, value));
    dl.appendChild(row);
  }

  function render() {
    document.title = product.title + ' | Ready to Ship | Azoir & Co.';
    $('pcStatus').hidden = true;
    $('pcBody').hidden = false;
    $('pcType').textContent = product.productType ? '/ ' + product.productType : '';
    $('pcTitle').textContent = product.title;
    $('pcDesc').textContent = product.description || '';
    var photo = $('pcPhoto'), thumbs = $('pcThumbs');
    var show = function (img, btn) {
      photo.src = img.url; photo.alt = img.altText || product.title;
      Array.prototype.forEach.call(thumbs.children, function (c) { c.setAttribute('aria-current', c === btn ? 'true' : 'false'); });
    };
    if (product.images.length) {
      product.images.forEach(function (img, i) {
        if (product.images.length < 2) return;
        var b = el('button', { type: 'button', 'aria-label': 'Photo ' + (i + 1) });
        b.appendChild(el('img', { src: img.url, alt: '', loading: 'lazy' }));
        b.addEventListener('click', function () { show(img, b); });
        thumbs.appendChild(b);
      });
      show(product.images[0], thumbs.children[0]);
    }
    var dl = $('pcSpecs');
    spec(dl, 'Metal', product.metal);
    spec(dl, 'Weight', product.specs && product.specs.weightG ? product.specs.weightG + ' g' : '');
    spec(dl, 'Width', product.specs && product.specs.widthMm ? product.specs.widthMm + ' mm' : '');
    var lead = product.leadTimeDays;
    spec(dl, 'Ships', lead ? 'In ' + (lead.min === lead.max ? lead.max : lead.min + '–' + lead.max) + ' business days' : '');

    var box = $('pcOptions');
    product.options.forEach(function (o) {
      if (o.values.length < 2) return;
      var wrap = el('label', { class: 'rts-opt' });
      wrap.appendChild(el('span', null, o.name));
      var s = el('select', { 'data-option': o.name });
      o.values.forEach(function (v) { s.appendChild(el('option', { value: v }, v)); });
      s.addEventListener('change', pickVariant);
      wrap.appendChild(s);
      box.appendChild(wrap);
    });
    if (/[?&]cancelled=1/.test(location.search)) $('pcCancelled').hidden = false;
    pickVariant();
  }

  getJson('/shop/api/products/' + encodeURIComponent(handle)).then(function (r) {
    if (r.status !== 200 || !r.body.product) {
      $('pcStatus').hidden = true;
      if (r.status === 404) $('pcMissing').hidden = false;
      else { $('pcStatus').hidden = false; $('pcStatus').textContent = "We couldn't load this piece just now. Please try again in a moment."; }
      return;
    }
    product = r.body.product;
    render();
  }).catch(function () { $('pcStatus').textContent = "We couldn't load this piece just now. Please try again in a moment."; });

  var form = $('pcForm'), err = $('pcErr'), pay = $('pcPay'), totals = $('pcTotals');
  $('pcBuy').addEventListener('click', function () {
    form.hidden = false;
    $('pcBuy').hidden = true;
    form.elements.email.focus();
    quote();
  });

  function fail(message) { err.textContent = message; err.hidden = false; }
  var MESSAGES = {
    sold_out: 'This piece has just sold. We are sorry to have missed you.',
    no_shipping_to_country: "We don't ship to that country yet. Write to hello@azoir.co and we'll arrange it.",
    invalid_address: 'Please check the address: name, street, city, postal code and country are needed.',
    state_required: 'Please add your state. US sales tax goes by state.',
    invalid_email: 'Please enter a valid email address.',
    size_required: 'Please choose a size.',
    too_many_requests: 'Too many attempts. Please wait a few minutes and try again.'
  };

  // Shipping, tax and total for the chosen country — shown before the customer commits.
  var quoteSeq = 0;
  function quote() {
    if (!variant) return;
    var seq = ++quoteSeq;
    post('/shop/api/quote', { variantId: variant.id, countryCode: form.elements.countryCode.value, province: form.elements.province.value }).then(function (r) {
      if (seq !== quoteSeq) return;
      totals.textContent = '';
      if (r.status !== 200) { totals.hidden = true; return; }
      var q = r.body;
      if (q.shippingError === 'no_shipping_to_country') { totals.hidden = true; fail(MESSAGES.no_shipping_to_country); return; }
      err.hidden = true;
      var row = function (label, value, cls) {
        var d = el('div', cls ? { class: cls } : null);
        d.appendChild(el('dt', null, label));
        d.appendChild(el('dd', null, value));
        totals.appendChild(d);
      };
      row('Piece', money(q.subtotal));
      row('Shipping', q.shipping ? (Number(q.shipping.price.amount) ? money(q.shipping.price) : 'Free') : '—');
      if (q.tax && q.tax.calculatedAtCheckout) row('Sales tax', 'Calculated at payment');
      else if (q.tax && Number(q.tax.amount.amount) > 0) row(q.tax.includedInPrices ? 'Sales tax (included)' : 'Sales tax', money(q.tax.amount));
      row(q.tax && q.tax.calculatedAtCheckout ? 'Total before tax' : 'Total', money(q.total), 'total');
      totals.hidden = false;
    }).catch(function () { totals.hidden = true; });
  }
  form.elements.countryCode.addEventListener('change', quote);
  form.elements.province.addEventListener('change', quote);

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    err.hidden = true;
    var f = form.elements, missing = null;
    // US sales tax goes by state, so a US address needs one.
    ['email', 'name', 'line1', 'city', 'postalCode'].concat(f.countryCode.value === 'US' ? ['province'] : []).forEach(function (n) {
      var bad = !f[n].value.trim() || (n === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f[n].value.trim()));
      f[n].setAttribute('aria-invalid', bad ? 'true' : 'false');
      if (bad && !missing) missing = f[n];
    });
    if (missing) { fail(missing.name === 'email' ? MESSAGES.invalid_email : missing.name === 'province' ? MESSAGES.state_required : MESSAGES.invalid_address); missing.focus(); return; }
    pay.disabled = true;
    pay.textContent = 'Reserving your piece…';
    post('/shop/api/checkout', {
      handle: handle, variantId: variant.id, size: size,
      email: f.email.value, name: f.name.value, line1: f.line1.value, line2: f.line2.value, city: f.city.value,
      province: f.province.value, postalCode: f.postalCode.value, countryCode: f.countryCode.value, phone: f.phone.value,
      company: f.company.value
    }).then(function (r) {
      if (r.status === 200 && r.body.url) { location.href = r.body.url; return; }
      pay.disabled = false;
      pay.textContent = 'Continue to payment';
      // A code this page doesn't know yet still shows the server's own wording when it sends one.
      fail(MESSAGES[r.body.error] || (r.status === 422 && r.body.message) || "We couldn't start the payment just now. Please try again in a moment.");
      if (r.body.error === 'sold_out') { form.hidden = true; $('pcSold').hidden = false; }
    }).catch(function () {
      pay.disabled = false;
      pay.textContent = 'Continue to payment';
      fail("We couldn't reach the server. Please check your connection and try again.");
    });
  });
})();
