/**
 * Theme and density preferences, the only two things persisted locally.
 * Delegated from `document` so the controls survive HTMX swaps.
 */
(function () {
  'use strict';

  var root = document.documentElement;

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

  function flip(theme) {
    return theme === 'dark' ? 'light' : 'dark';
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
})();
