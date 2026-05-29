/* ============================================================
   NarrateRx — site.js
   No build step, no deps. Shared across all marketing pages.
   ============================================================ */
(function () {
  'use strict';

  /* ---- 1. Year stamps ---------------------------------------- */
  document.querySelectorAll('[data-year]').forEach(function (el) {
    el.textContent = String(new Date().getFullYear());
  });

  /* ---- 2. Mobile nav toggle ---------------------------------- */
  var toggle = document.querySelector('.uhdr-toggle');
  var nav    = document.querySelector('.uhdr-nav');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    nav.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') {
        nav.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  /* ---- 3. Active nav state from URL -------------------------- */
  (function markActiveNav() {
    var path = (location.pathname || '/').replace(/\/$/, '') || '/';
    document.querySelectorAll('.uhdr-nav a').forEach(function (a) {
      var href = a.getAttribute('href') || '';
      if (href.charAt(0) === '#') return;
      var hrefPath = href.split('#')[0].replace(/\/$/, '') || '/';
      if (hrefPath === path) a.classList.add('is-active');
    });
  })();

  /* ---- 4. Scroll-reveal (.ureveal) --------------------------- */
  (function initReveal() {
    var els = document.querySelectorAll('.ureveal');
    if (!els.length) return;
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            e.target.classList.add('is-visible');
            io.unobserve(e.target);
          }
        });
      }, { threshold: 0.12 });
      els.forEach(function (el) { io.observe(el); });
    } else {
      els.forEach(function (el) { el.classList.add('is-visible'); });
    }
  })();

  /* ---- 5. Voice compare toggle (.uvoice-toggle) -------------- */
  document.querySelectorAll('[data-voice-compare]').forEach(function (wrap) {
    var btns   = wrap.querySelectorAll('.uvoice-toggle button');
    var panels = wrap.querySelectorAll('.uvoice-panel');
    if (!btns.length) return;

    btns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-key');
        btns.forEach(function (b) { b.classList.remove('is-active'); });
        btn.classList.add('is-active');
        panels.forEach(function (p) {
          p.classList.toggle('is-visible', p.getAttribute('data-key') === key);
        });
      });
    });
    // Init first as active
    if (btns[1]) btns[1].click();
  });

  /* ---- 6. FAQ accordion — smooth open (native <details>) ----- */
  // <details> works natively; this just ensures smooth animation via CSS.
  // No JS needed beyond letting the browser handle it.

  /* ---- 7. Number counter animation --------------------------- */
  (function initCounters() {
    var counters = document.querySelectorAll('[data-count]');
    if (!counters.length) return;
    var io = ('IntersectionObserver' in window)
      ? new IntersectionObserver(function (entries) {
          entries.forEach(function (e) {
            if (e.isIntersecting) {
              animateCount(e.target);
              io.unobserve(e.target);
            }
          });
        }, { threshold: 0.5 })
      : null;

    counters.forEach(function (el) {
      if (io) io.observe(el); else animateCount(el);
    });

    function animateCount(el) {
      var target = parseFloat(el.getAttribute('data-count'));
      var suffix = el.getAttribute('data-suffix') || '';
      var duration = 900;
      var start = performance.now();
      (function tick(now) {
        var pct = Math.min((now - start) / duration, 1);
        var val = target * ease(pct);
        el.textContent = (Number.isInteger(target) ? Math.round(val) : val.toFixed(1)) + suffix;
        if (pct < 1) requestAnimationFrame(tick);
      })(start);
    }
    function ease(t) { return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; }
  })();

  /* ---- 8. Pipeline step highlight (how-it-works) ------------- */
  (function initPipeline() {
    var steps = document.querySelectorAll('.upipe-step');
    if (!steps.length) return;
    steps.forEach(function (step, i) {
      setTimeout(function () {
        var io2 = new IntersectionObserver(function (entries) {
          if (entries[0].isIntersecting) step.style.opacity = '1';
        }, { threshold: 0.3 });
        io2.observe(step);
      }, i * 60);
    });
  })();

  /* ---- 9. Interactive demo (.upreview[data-demo]) ------------ */
  // Shows the core "trick" right on the page: a real interview answer types
  // out, NarrateRx "writes", and a finished post appears. Channel tabs swap
  // the same idea between Blog / Social / Email / Google. Pure vanilla JS,
  // honors prefers-reduced-motion (jumps straight to the finished state).
  (function initDemo() {
    var demos = document.querySelectorAll('[data-demo]');
    if (!demos.length) return;

    var ANSWER = "That pain is usually a movement problem, not a damage problem. The MRI almost never explains it — the way someone moves always does. I've watched people carry a scary-sounding diagnosis for years when the real fix was teaching them to breathe and move differently.";

    var OUTPUTS = {
      blog: {
        head: "Your MRI doesn't explain your pain. The way you move does.",
        meta: "Blog post · 950 words · your site",
        body: "Here's something I wish every patient understood: pain is usually a movement problem, not a damage problem. Imaging is seductive — there's a bulging disc on the scan, so the disc must be the cause. But studies of pain-free adults find “abnormalities” in well over half of them. The picture and the pain rarely match. <span class=\"chip\">The way you move</span> almost always tells the real story."
      },
      social: {
        head: "The scan isn't the whole story.",
        meta: "Social caption · ready for Instagram & LinkedIn",
        body: "Most back pain isn't damage — it's movement. I've seen patients carry a scary diagnosis for years when the real fix was learning to breathe and move differently. If your MRI “looks bad” but you're still in pain, the picture isn't the problem. <span class=\"chip\">Your movement is.</span>"
      },
      email: {
        head: "Subject: Why your scan might be lying to you",
        meta: "Newsletter · ready to send",
        body: "Hi friend — quick one this week. The single biggest thing I wish every patient knew: pain is usually a movement problem, not a damage problem. A “bad” MRI doesn't have to mean a bad future. Most of the time the fix is teaching the body to <span class=\"chip\">breathe and move differently</span> — and that's far more hopeful than any scan."
      },
      google: {
        head: "Pain that won't quit? It might be how you move.",
        meta: "Google Business post · local",
        body: "Most pain we see isn't permanent damage — it's a movement pattern that can change. If a scan has you worried, come talk to us before you accept the worst-case story. <span class=\"chip\">Book a movement assessment</span> and let's look at the whole picture."
      }
    };

    var reduce = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    demos.forEach(function (root) {
      var answerEl = root.querySelector('[data-demo-answer]');
      var statusEl = root.querySelector('[data-demo-status]');
      var tabsWrap = root.querySelector('[data-demo-tabs]');
      var outEl    = root.querySelector('[data-demo-out]');
      var replay   = root.querySelector('[data-demo-replay]');
      var tabs     = tabsWrap ? tabsWrap.querySelectorAll('[data-tab]') : [];
      if (!answerEl || !outEl) return;

      var typeTimer = null;
      var started = false;

      function setStatus(text) { if (statusEl) statusEl.textContent = text; }

      function renderOut(key) {
        var o = OUTPUTS[key];
        if (!o) return;
        outEl.innerHTML =
          '<span class="head">' + o.head + '</span>' +
          '<span class="meta">' + o.meta + '</span>' + o.body;
        outEl.classList.remove('is-in');
        void outEl.offsetWidth;       // restart the fade
        outEl.classList.add('is-in');
        tabs.forEach(function (t) {
          t.classList.toggle('is-on', t.getAttribute('data-tab') === key);
        });
      }

      function typeAnswer(text, done) {
        clearInterval(typeTimer);
        answerEl.textContent = '';
        answerEl.classList.add('is-typing');
        var i = 0;
        typeTimer = setInterval(function () {
          i += 2;                     // 2 chars/tick — quick but legible
          answerEl.textContent = text.slice(0, i);
          if (i >= text.length) {
            answerEl.textContent = text;
            clearInterval(typeTimer);
            answerEl.classList.remove('is-typing');
            if (done) done();
          }
        }, 16);
      }

      function showFinished() {
        answerEl.textContent = ANSWER;
        answerEl.classList.remove('is-typing');
        setStatus('NarrateRx · generated 4 drafts');
        renderOut('blog');
      }

      function play() {
        clearInterval(typeTimer);
        outEl.innerHTML = '';
        tabs.forEach(function (t) { t.classList.remove('is-on'); });
        setStatus('NarrateRx · listening…');
        typeAnswer(ANSWER, function () {
          setStatus('NarrateRx · writing…');
          setTimeout(function () {
            setStatus('NarrateRx · generated 4 drafts');
            renderOut('blog');
          }, 750);
        });
      }

      // Channel tabs — click or keyboard.
      tabs.forEach(function (t) {
        t.addEventListener('click', function () {
          renderOut(t.getAttribute('data-tab'));
        });
        t.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            renderOut(t.getAttribute('data-tab'));
          }
        });
      });
      if (replay) replay.addEventListener('click', play);

      function start() {
        if (started) return;
        started = true;
        if (reduce) showFinished(); else play();
      }

      if ('IntersectionObserver' in window) {
        var io = new IntersectionObserver(function (entries) {
          entries.forEach(function (e) {
            if (e.isIntersecting) { start(); io.unobserve(e.target); }
          });
        }, { threshold: 0.35 });
        io.observe(root);
      } else {
        start();
      }
    });
  })();

})();
