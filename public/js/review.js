/**
 * Document review and prompt revision selection on the Data forge screen.
 *
 * The review gate is deliberately a small API action. Refreshing the forge
 * workspace afterwards keeps the ledger counts, topic counts, and card state
 * derived from the same database snapshot.
 */
(function () {
  'use strict';

  document.addEventListener('click', async function (event) {
    var button = event.target.closest('[data-document-review]');
    if (!button || button.disabled) return;
    var code = button.dataset.documentCode;
    var decision = button.dataset.documentReview;
    if (!code || (decision !== 'approved' && decision !== 'rejected')) return;
    event.preventDefault();
    document.querySelectorAll('[data-document-code="' + code + '"]').forEach(function (item) { item.disabled = true; });
    try {
      var response = await fetch('/api/v1/documents/' + encodeURIComponent(code) + '/review', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({status: decision}),
      });
      var result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to update document review.');
      if (window.htmx) window.htmx.ajax('GET', window.location.pathname + window.location.search, {target: '#workspace', swap: 'innerHTML'});
    } catch (error) {
      document.querySelectorAll('[data-document-code="' + code + '"]').forEach(function (item) { item.disabled = false; });
      window.alert(error.message || 'Unable to update document review.');
    }
  });

  document.addEventListener('change', function (event) {
    var picker = event.target.closest('[data-prompt-revision]');
    if (!picker) return;
    var hidden = document.getElementById('forge-prompt-revision');
    if (hidden) hidden.value = picker.value;
  });
})();
