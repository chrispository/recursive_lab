/**
 * Results screen interactions: the failed-only filter and the criterion
 * dialogs. Both delegated from `document` so they survive HTMX swaps.
 */
(function () {
  'use strict';

  // A CSS view over the rows already on the page: nothing is removed, so the
  // rows you had open are still open when the filter comes back off.
  document.addEventListener('click', function (event) {
    var toggle = event.target.closest('[data-criteria-filter]');
    if (!toggle) return;
    var box = toggle.closest('.m-criteria-box');
    if (!box) return;
    var on = box.dataset.filter !== 'unpassed';
    if (on) box.dataset.filter = 'unpassed';
    else delete box.dataset.filter;
    toggle.setAttribute('aria-pressed', String(on));
    toggle.textContent = on ? 'Show all criteria' : 'Show failed only';
  });

  // Native <dialog>: `showModal` brings focus trapping, Esc, and the backdrop
  // without a library.
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
})();
