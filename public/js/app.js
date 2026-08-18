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
  function syncChoices(attribute, value) {
    var dataKey = attribute.slice(5).replace(/-([a-z])/g, function (_match, letter) { return letter.toUpperCase(); });
    document.querySelectorAll('[' + attribute + ']').forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.dataset[dataKey] === value));
    });
  }

  function setPref(key, value, attr) {
    localStorage.setItem('recursive-' + key, value);
    root.dataset[attr] = value;
    syncChoices('data-set-' + key, value);
  }

  root.dataset.density = root.dataset.density || 'comfort';
  syncChoices('data-set-theme', root.dataset.theme);
  syncChoices('data-set-density', root.dataset.density);

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
     Progress is published as --hold-progress so the CSS can draw the fill.

     No control uses this yet; it is here for the hold-to-recurse button in
     todo.md § 6. If that item is ever dropped, drop this with it. */

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

  /* Settings form ---------------------------------------------------------
     The provider screen saves only through the server; secret values are never
     copied into a response. Delegation keeps this alive after HTMX swaps. */

  function formValues(form) {
    var values = {};
    new FormData(form).forEach(function (value, key) {
      if (typeof value === 'string') values[key] = value;
    });
    return values;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, function (character) {
      return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character];
    });
  }

  function showSettingsMessage(message, error) {
    var target = document.getElementById('settings-test-results');
    if (!target) return;
    target.innerHTML = '<div class="m-api-result" data-status="' + (error ? 'error' : 'ok') + '"><strong>Settings</strong><span class="m-api-detail">' + escapeHtml(message) + '</span></div>';
  }

  document.addEventListener('submit', async function (event) {
    var form = event.target.closest('[data-settings-form]');
    if (!form) return;
    event.preventDefault();
    try {
      var response = await fetch('/api/v1/settings', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(formValues(form)),
      });
      var result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to save settings.');
      showSettingsMessage('Settings saved. Secret values remain local.', false);
    } catch (error) {
      showSettingsMessage(error.message || 'Unable to save settings.', true);
    }
  });

  document.addEventListener('click', async function (event) {
    var button = event.target.closest('[data-settings-test]');
    if (!button) return;
    var form = button.closest('form');
    if (!form) return;
    button.disabled = true;
    showSettingsMessage('Testing provider connections…', false);
    try {
      var response = await fetch('/api/v1/settings/test', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(formValues(form)),
      });
      var result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to test settings.');
      var target = document.getElementById('settings-test-results');
      if (target) target.innerHTML = result.results.map(function (item) {
        return '<div class="m-api-result" data-status="' + escapeHtml(item.status) + '"><strong>' + escapeHtml(item.label) + '</strong><span class="m-api-detail">' + escapeHtml(item.detail) + '</span><span>' + (item.latency_ms == null ? '—' : item.latency_ms + ' ms') + '</span><span class="m-api-status">' + escapeHtml(item.status) + '</span></div>';
      }).join('');
    } catch (error) {
      showSettingsMessage(error.message || 'Unable to test settings.', true);
    } finally {
      button.disabled = false;
    }
  });

  /* Benchmark configuration ----------------------------------------------
     The catalog is rendered server-side; filtering and selection stay local
     so a large task list remains responsive without another round trip. */

  function refreshTaskPicker() {
    var filter = document.getElementById('task-filter');
    var count = document.getElementById('task-count');
    var rows = Array.from(document.querySelectorAll('[data-task-row]'));
    if (!filter || !count || !rows.length) return;

    var needle = String(filter.value || '').trim().toLowerCase();
    var visible = 0;
    var selected = 0;
    rows.forEach(function (row) {
      var haystack = String(row.dataset.taskId || '') + ' ' + String(row.textContent || '').toLowerCase();
      var matches = !needle || haystack.includes(needle);
      row.hidden = !matches;
      if (matches) visible += 1;
      var checkbox = row.querySelector('[data-task-checkbox]');
      if (checkbox && checkbox.checked) selected += 1;
    });
    var total = Number(count.dataset.taskTotal || rows.length);
    count.textContent = selected + ' selected / ' + visible.toLocaleString() + ' shown / ' + total.toLocaleString() + ' total';
  }

  document.addEventListener('input', function (event) {
    if (event.target && event.target.id === 'task-filter') refreshTaskPicker();
  });

  document.addEventListener('change', function (event) {
    if (event.target && event.target.matches('[data-task-checkbox]')) refreshTaskPicker();
  });

  document.addEventListener('click', function (event) {
    var checkVisible = event.target.closest('#check-visible');
    if (checkVisible) {
      document.querySelectorAll('[data-task-row]:not([hidden]) [data-task-checkbox]').forEach(function (checkbox) {
        checkbox.checked = true;
      });
      refreshTaskPicker();
      return;
    }

    var clearTasks = event.target.closest('#clear-tests');
    if (clearTasks) {
      document.querySelectorAll('[data-task-checkbox]').forEach(function (checkbox) {
        checkbox.checked = false;
      });
      refreshTaskPicker();
      return;
    }

    var action = event.target.closest('[data-benchmark-action]');
    var status = document.getElementById('benchmark-config-status');
    if (action && status) {
      collapseRunConfig();
      status.textContent = 'Full-process configuration is ready. Recurse is not wired yet.';
    }
  });

  document.addEventListener('htmx:afterSwap', refreshTaskPicker);
  refreshTaskPicker();

  /* Criterion dialogs -----------------------------------------------------
     Native <dialog>: `showModal` brings focus trapping, Esc, and the backdrop
     without a library. Delegated like everything else here so the buttons keep
     working after HTMX replaces the results region. */

  document.addEventListener('click', function (event) {
    var opener = event.target.closest('[data-open-dialog]');
    if (opener) {
      var dialog = document.getElementById(opener.dataset.openDialog);
      if (dialog && typeof dialog.showModal === 'function') {
        event.preventDefault();
        dialog.showModal();
      }
      return;
    }

    var closer = event.target.closest('[data-close-dialog]');
    if (closer) {
      var owned = closer.closest('dialog');
      if (owned) owned.close();
      return;
    }

    // Clicking the backdrop targets the dialog element itself, since its own
    // children cover everything inside it. Closing on that is the behaviour a
    // modal is expected to have and the one <dialog> does not give for free.
    if (event.target.tagName === 'DIALOG') event.target.close();
  });

  /* After a run starts, fold the configuration so the ledger is on screen.
     Gear clicks must not toggle the <details> they live in. */

  function reducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /** The fold duration, defined once in ledger.css as --collapse-ms. */
  function collapseDuration(panel) {
    var raw = getComputedStyle(panel).getPropertyValue('--collapse-ms');
    var ms = parseFloat(raw);
    if (!isFinite(ms) || ms <= 0) return 600;
    // A bare number in the custom property would be seconds under CSS rules;
    // only trust the unit that is actually written there.
    return raw.indexOf('ms') >= 0 ? ms : ms * 1000;
  }

  /**
   * Fold the panel by animating its height, then closing it.
   *
   * `<details>` cannot be transitioned: setting `open = false` removes the body
   * from layout in one frame, so the ledger below jumps up instead of following
   * the panel. Keeping the element open for the length of the animation and
   * shrinking its measured height means the ledger is moved by ordinary flow —
   * it rises because the box above it is shrinking, which is exactly the effect
   * a transition on `open` cannot produce.
   *
   * The closed height is measured by closing the panel and reading it back
   * before anything paints, so the animation lands on the real resting height
   * rather than an estimate assembled from the summary's box.
   */
  function collapseRunConfig() {
    var panel = document.getElementById('benchmarks-config');
    var ledger = document.getElementById('benchmarks-ledger');
    var settle = function () {
      if (ledger) ledger.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    };
    if (!panel || !panel.open || panel.classList.contains('is-collapsing')) return;

    if (reducedMotion() || typeof panel.animate !== 'function') {
      panel.open = false;
      settle();
      return;
    }

    var start = panel.getBoundingClientRect().height;
    panel.open = false;
    var end = panel.getBoundingClientRect().height;
    panel.open = true;

    if (!(start > end)) {
      panel.open = false;
      settle();
      return;
    }

    panel.classList.add('is-collapsing');
    var animation = panel.animate(
      [{ height: start + 'px' }, { height: end + 'px' }],
      { duration: collapseDuration(panel), easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)' },
    );

    // `finish` has to run on cancel too, or an interrupted fold would strand
    // the panel open with a stale class and no way back.
    var finish = function () {
      panel.classList.remove('is-collapsing');
      panel.open = false;
      settle();
    };
    animation.addEventListener('finish', finish);
    animation.addEventListener('cancel', finish);
  }

  document.addEventListener('click', function (event) {
    if (event.target.closest('#benchmarks-config .m-settings-link')) {
      event.stopPropagation();
    }
  }, true);

  document.addEventListener('htmx:afterSwap', function (event) {
    var target = event.detail && event.detail.target;
    if (target && target.id === 'benchmark-config-status' && target.querySelector('[data-run-started]')) {
      collapseRunConfig();
    }
  });
})();
