/**
 * Settings provider form. Saves only through the server; secret values are
 * never copied into a response. Delegation keeps this alive after HTMX swaps.
 */
(function () {
  'use strict';

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
})();
