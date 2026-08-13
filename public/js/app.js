/**
 * The only client-side script. Everything here is delegated from `document`, so
 * it keeps working after HTMX replaces part of the page — the previous version
 * of this app bound listeners once at load and silently broke on every swap.
 *
 * Server state belongs to the server. This file handles nothing but display
 * preferences and the hold-to-confirm control.
 */
(function () {
  'use strict';

  var root = document.documentElement;

  /** Theme and density are the only two things we persist locally. */
  function setPref(key, value, attr) {
    localStorage.setItem('recursive-' + key, value);
    root.dataset[attr] = value;
  }

  document.addEventListener('click', function (event) {
    var themeBtn = event.target.closest('[data-set-theme]');
    if (themeBtn) {
      var next = themeBtn.dataset.setTheme;
      setPref('theme', next === 'toggle' ? flip(root.dataset.theme) : next, 'theme');
      return;
    }

    var densityBtn = event.target.closest('[data-set-density]');
    if (densityBtn) setPref('density', densityBtn.dataset.setDensity, 'density');
  });

  function flip(theme) {
    return theme === 'dark' ? 'light' : 'dark';
  }

  /* Hold-to-confirm ---------------------------------------------------------
     A button marked [data-hold] must be held for its duration before it fires.
     Progress is published as --hold-progress so the CSS can draw the fill. */

  var holding = null;

  document.addEventListener('pointerdown', function (event) {
    var button = event.target.closest('[data-hold]');
    if (!button) return;
    var duration = Number(button.dataset.hold) || 1400;
    holding = { button: button, start: performance.now(), duration: duration };
    button.setPointerCapture?.(event.pointerId);
    requestAnimationFrame(tick);
  });

  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (name) {
    document.addEventListener(name, reset);
  });

  function tick(now) {
    if (!holding) return;
    var progress = Math.min(1, (now - holding.start) / holding.duration);
    holding.button.style.setProperty('--hold-progress', (progress * 100).toFixed(1) + '%');

    if (progress < 1) return requestAnimationFrame(tick);

    var button = holding.button;
    holding = null;
    button.style.setProperty('--hold-progress', '0%');
    button.classList.remove('is-ready');
    // Let htmx handle the actual request; we only decide *when* it may fire.
    button.dispatchEvent(new CustomEvent('hold:complete', { bubbles: true }));
  }

  function reset() {
    if (!holding) return;
    holding.button.style.setProperty('--hold-progress', '0%');
    holding.button.classList.remove('is-ready');
    holding = null;
  }
})();
