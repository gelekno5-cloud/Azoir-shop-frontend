// @ts-nocheck
// assets/homepage-hero.js — Azoir scroll-driven hero v1

(function () {
  'use strict';

  var root = document.getElementById('azh-root');
  if (!root) return;

  // ── Config ────────────────────────────────────────────────────

  var FRAMES_BASE = root.dataset.framesBase;
  var FRAME_COUNT = parseInt(root.dataset.frameCount, 10) || 192;
  var isMobile    = window.innerWidth < 769;
  var FRAME_SPEED = 1.163; // last frame at exactly 86% scroll = CTA entry
  var IMAGE_SCALE = 0.88;

  // Cap DPR at 2 — a 3× screen does 2.25× more pixel work for no visible gain
  var dpr = Math.min(window.devicePixelRatio || 1, 2);

  // Dark overlay range (stats section: 64–78%)
  var OVERLAY_ENTER = 0.64;
  var OVERLAY_LEAVE = 0.78;
  var OVERLAY_FADE  = 0.03;

  // Marquee range
  var MARQUEE_ENTER = 0.76;
  var MARQUEE_LEAVE = 0.90;
  var MARQUEE_FADE  = 0.03;

  // ── Elements ──────────────────────────────────────────────────

  var canvas      = document.getElementById('azh-canvas');
  var ctx         = canvas.getContext('2d');
  var heroLayer   = document.getElementById('azh-hero-layer');
  var darkOverlay = document.getElementById('azh-dark-overlay');
  var marqueeWrap = document.getElementById('azh-marquee');
  var marqueeText = marqueeWrap.querySelector('.azh-marquee-text');
  var sections    = Array.from(document.querySelectorAll('.azh-section'));

  // ── State ─────────────────────────────────────────────────────

  var frames       = new Array(FRAME_COUNT).fill(null);
  var currentFrame = 0;
  var canvasW      = 0;
  var canvasH      = 0;

  // ── Strip wrapper border ──────────────────────────────────────

  (function stripBorder() {
    var el = root;
    for (var i = 0; i < 4; i++) {
      el = el && el.parentElement;
      if (!el) break;
      el.style.setProperty('border', 'none', 'important');
      el.style.setProperty('outline', 'none', 'important');
      el.style.setProperty('box-shadow', 'none', 'important');
      el.style.setProperty('padding', '0', 'important');
      el.style.setProperty('margin', '0', 'important');
    }
  })();

  // ── Canvas ────────────────────────────────────────────────────

  function resizeCanvas() {
    var sticky = document.getElementById('azh-sticky');
    canvasW = sticky ? sticky.offsetWidth  : Math.min(window.innerWidth, 1440);
    canvasH = sticky ? sticky.offsetHeight : window.innerHeight;
    canvas.width  = canvasW * dpr;
    canvas.height = canvasH * dpr;
    canvas.style.width  = canvasW + 'px';
    canvas.style.height = canvasH + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Medium quality is measurably faster than high with imperceptible difference on video frames
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'medium';
    drawFrame(currentFrame);
  }

  function drawFrame(index) {
    var frame = frames[index];
    if (!frame) {
      for (var i = index - 1; i >= 0; i--) {
        if (frames[i]) { frame = frames[i]; break; }
      }
    }
    if (!frame) return;

    // ImageBitmap exposes .width/.height; HTMLImageElement exposes .naturalWidth/.naturalHeight
    var iw = frame.width  || frame.naturalWidth;
    var ih = frame.height || frame.naturalHeight;
    var cw = canvasW || window.innerWidth;
    var ch = canvasH || window.innerHeight;

    ctx.fillStyle = '#fafaf8';
    ctx.fillRect(0, 0, cw, ch);

    if (isMobile) {
      // 90° CW rotation fills portrait screen with landscape frame
      var scale = Math.max(ch / iw, cw / ih);
      var dw = iw * scale, dh = ih * scale;
      ctx.save();
      ctx.translate(cw / 2, ch / 2);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(frame, -dw / 2, -dh / 2, dw, dh);
      ctx.restore();
    } else {
      var scale = Math.max(cw / iw, ch / ih) * IMAGE_SCALE;
      var dw = iw * scale, dh = ih * scale;
      ctx.drawImage(frame, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
    }
  }

  // ── Frame loading ─────────────────────────────────────────────

  function frameUrl(i) {
    return FRAMES_BASE + '/frame_' + String(i + 1).padStart(4, '0') + '.webp';
  }

  function loadFrame(i) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        // createImageBitmap produces a GPU-resident texture; drawImage with it
        // skips per-draw CPU decode entirely — biggest single perf win
        if (window.createImageBitmap) {
          createImageBitmap(img)
            .then(function (bmp) { frames[i] = bmp; resolve(); })
            .catch(function () {
              // CORS/security fallback — decode at least so drawImage doesn't stall
              var p = img.decode ? img.decode() : Promise.resolve();
              p.then(function () { frames[i] = img; resolve(); })
               .catch(function () { frames[i] = img; resolve(); });
            });
        } else if (img.decode) {
          img.decode()
            .then(function () { frames[i] = img; resolve(); })
            .catch(function () { frames[i] = img; resolve(); });
        } else {
          frames[i] = img;
          resolve();
        }
      };
      img.onerror = resolve;
      img.src = frameUrl(i);
    });
  }

  function preloadFrames() {
    var first = [];
    for (var i = 0; i < Math.min(12, FRAME_COUNT); i++) first.push(loadFrame(i));
    Promise.all(first).then(function () {
      drawFrame(0);
      initAnimations();
      var j = 12;
      function loadBatch() {
        if (j >= FRAME_COUNT) return;
        // 6 at a time — fewer parallel requests keeps the network lane clear
        // and avoids the browser scheduler thrashing during scroll
        var end = Math.min(j + 6, FRAME_COUNT), batch = [];
        for (var k = j; k < end; k++) batch.push(loadFrame(k));
        j = end;
        Promise.all(batch).then(function () { requestAnimationFrame(loadBatch); });
      }
      loadBatch();
    });
  }

  // ── Init animations ───────────────────────────────────────────

  function initAnimations() {
    gsap.registerPlugin(ScrollTrigger);

    // Lenis smooth scroll — desktop only; iOS momentum scroll is better on touch
    if (window.Lenis && !isMobile) {
      var lenis = new Lenis({
        duration: 1.1,
        easing: function (t) { return Math.min(1, 1.001 - Math.pow(2, -10 * t)); },
        smoothWheel: true,
      });
      lenis.on('scroll', ScrollTrigger.update);
      gsap.ticker.add(function (time) { lenis.raf(time * 1000); });
      gsap.ticker.lagSmoothing(0);
    }

    // Prepare sections
    sections.forEach(prepareSection);

    // Counter init
    document.querySelectorAll('.azh-stat-number').forEach(function (el) {
      el._counted  = false;
      el._target   = parseFloat(el.dataset.value);
      el._decimals = parseInt(el.dataset.decimals || '0', 10);
    });

    // Main scroll driver
    // scrub: 1.5 adds interpolation lag — the canvas catches up over 1.5s instead of
    // jumping instantly, which hides the frame-skip jank at fast scroll speeds.
    var rafPending = false;
    var latestProgress = 0;
    ScrollTrigger.create({
      trigger: root,
      start: 'top top',
      end: 'bottom bottom',
      scrub: 1.5,
      onUpdate: function (self) {
        latestProgress = self.progress;
        if (!rafPending) {
          rafPending = true;
          requestAnimationFrame(function () {
            rafPending = false;
            var p = latestProgress;
            updateHeroLayer(p);
            updateFrame(p);
            updateDarkOverlay(p);
            updateMarquee(p);
            updateSections(p);
          });
        }
      },
    });
  }

  // ── Hero layer ────────────────────────────────────────────────

  function updateHeroLayer(p) {
    if (heroLayer) heroLayer.style.opacity = Math.max(0, 1 - p * 18);
  }

  // ── Frame scrub ───────────────────────────────────────────────

  function updateFrame(p) {
    var accelerated = Math.min(p * FRAME_SPEED, 1);
    var index = Math.min(Math.floor(accelerated * FRAME_COUNT), FRAME_COUNT - 1);
    if (index !== currentFrame) {
      currentFrame = index;
      drawFrame(currentFrame);
    }
  }

  // ── Dark overlay ──────────────────────────────────────────────

  function updateDarkOverlay(p) {
    if (!darkOverlay) return;
    var fadeIn  = Math.max(0, Math.min(1, (p - OVERLAY_ENTER) / OVERLAY_FADE));
    var fadeOut = Math.max(0, Math.min(1, (p - (OVERLAY_LEAVE - OVERLAY_FADE)) / OVERLAY_FADE));
    darkOverlay.style.opacity = Math.max(0, fadeIn - fadeOut) * 0.9;
  }

  // ── Marquee ───────────────────────────────────────────────────

  function updateMarquee(p) {
    var fadeIn  = Math.max(0, Math.min(1, (p - MARQUEE_ENTER) / MARQUEE_FADE));
    var fadeOut = Math.max(0, Math.min(1, (p - (MARQUEE_LEAVE - MARQUEE_FADE)) / MARQUEE_FADE));
    marqueeWrap.style.opacity = Math.max(0, fadeIn - fadeOut);
    var shift = (p - MARQUEE_ENTER) * -80;
    marqueeText.style.transform = 'translateX(' + (20 + shift) + 'vw)';
  }

  // ── Sections ──────────────────────────────────────────────────

  function prepareSection(section) {
    section._enter   = parseFloat(section.dataset.enter)  / 100;
    section._leave   = parseFloat(section.dataset.leave)  / 100;
    section._anim    = section.dataset.animation;
    section._persist = section.dataset.persist === 'true';
    section._visible = false;
    section._animDone = false;

    var sel = '.azh-label, .azh-heading, .azh-body, .azh-cta-btn';
    section._children = Array.from(section.querySelectorAll(sel));

    gsap.set(section._children, { opacity: 0 });
  }

  function updateSections(p) {
    sections.forEach(function (sec) {
      var inRange    = p >= sec._enter && (p <= sec._leave || sec._persist);
      var shouldHide = p < sec._enter || (!sec._persist && p > sec._leave);

      if (inRange && !sec._visible) {
        sec.style.opacity = '1';
        sec._visible = true;
        animateIn(sec);
        if (!sec._animDone) {
          sec._animDone = true;
          sec.querySelectorAll('.azh-stat-number').forEach(runCounter);
        }
      } else if (shouldHide && sec._visible) {
        sec._visible = false;
        gsap.to(sec._children, { opacity: 0, duration: 0.3, ease: 'power2.in', stagger: 0.04 });
        setTimeout(function () { if (!sec._visible) sec.style.opacity = '0'; }, 400);
      }
    });
  }

  function animateIn(sec) {
    gsap.killTweensOf(sec._children);
    var base = { opacity: 1, stagger: 0.09, duration: 0.7, ease: 'power3.out' };

    switch (sec._anim) {
      case 'slide-left':
        gsap.fromTo(sec._children, { x: -48, opacity: 0 }, Object.assign({ x: 0 }, base));
        break;
      case 'slide-right':
        gsap.fromTo(sec._children, { x: 48, opacity: 0 }, Object.assign({ x: 0 }, base));
        break;
      case 'stagger-up':
        gsap.fromTo(sec._children, { y: 32, opacity: 0 }, Object.assign({ y: 0, stagger: 0.11 }, base));
        break;
      case 'fade-up':
        gsap.fromTo(sec._children, { y: 20, opacity: 0 }, Object.assign({ y: 0 }, base));
        break;
      default:
        gsap.fromTo(sec._children, { y: 16, opacity: 0 }, Object.assign({ y: 0 }, base));
    }
  }

  // ── Counters ──────────────────────────────────────────────────

  function runCounter(el) {
    if (el._counted) return;
    el._counted = true;
    var obj = { val: 0 };
    gsap.to(obj, {
      val: el._target,
      duration: 1.8,
      ease: 'power1.out',
      onUpdate: function () {
        el.textContent = el._decimals === 0
          ? Math.round(obj.val)
          : obj.val.toFixed(el._decimals);
      },
    });
  }

  // ── Boot ──────────────────────────────────────────────────────

  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();
  preloadFrames();

})();
