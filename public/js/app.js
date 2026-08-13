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
      var matches = !needle || String(row.dataset.taskId || '').includes(needle);
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
      status.textContent = action.dataset.benchmarkAction === 'manual'
        ? 'Manual run configuration is ready. The imported lab ledger remains read-only in this local view.'
        : 'Full-process configuration is ready. The imported lab ledger remains read-only in this local view.';
    }
  });

  document.addEventListener('htmx:afterSwap', refreshTaskPicker);
  refreshTaskPicker();
})();
