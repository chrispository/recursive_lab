/**
 * Document review and prompt revision selection on the Data forge screen.
 *
 * The review gate is deliberately a small API action. Refreshing the forge
 * workspace afterwards keeps the ledger counts, topic counts, and card state
 * derived from the same database snapshot.
 */
(function () {
  'use strict';

  function refreshWorkspace() {
    if (window.htmx) {
      window.htmx.ajax('GET', window.location.pathname + window.location.search, {target: '#workspace', swap: 'innerHTML'});
    } else {
      window.location.reload();
    }
  }

  function controlsFor(code) {
    return Array.from(document.querySelectorAll('[data-document-code]')).filter(function (item) {
      return item.dataset.documentCode === code;
    });
  }

  async function reviewDocument(code, decision) {
    var response = await fetch('/api/v1/documents/' + encodeURIComponent(code) + '/review', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({status: decision}),
    });
    var result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Unable to update document review.');
  }

  function showReviewDetail(inbox, code) {
    inbox.dataset.reviewSelected = code;
    inbox.querySelectorAll('[data-review-select]').forEach(function (row) {
      row.classList.toggle('is-selected', row.dataset.reviewSelect === code);
    });
    inbox.querySelectorAll('[data-review-detail]').forEach(function (detail) {
      detail.hidden = detail.dataset.reviewDetail !== code;
    });
  }

  function applyReviewFilters(inbox) {
    var filter = inbox.dataset.reviewStatusFilter;
    var topic = inbox.dataset.reviewTopic || 'all';
    inbox.querySelectorAll('button[data-review-filter]').forEach(function (button) {
      var active = button.dataset.reviewFilter === filter;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    var visible = [];
    inbox.querySelectorAll('[data-review-queue-row]').forEach(function (row) {
      var match = (filter === 'all' || row.dataset.reviewStatus === filter) && (topic === 'all' || row.dataset.reviewTopic === topic);
      row.hidden = !match;
      if (match) visible.push(row);
    });
    var pendingRows = Array.from(inbox.querySelectorAll('[data-review-queue-row]')).filter(function (row) {
      return row.dataset.reviewStatus === 'pending' && (topic === 'all' || row.dataset.reviewTopic === topic);
    });
    var bulk = inbox.querySelector('[data-review-bulk]');
    if (bulk) {
      bulk.disabled = pendingRows.length === 0;
      var bulkCount = bulk.querySelector('[data-review-bulk-count]');
      if (bulkCount) bulkCount.textContent = String(pendingRows.length);
      var bulkSummary = bulk.querySelector('[data-review-bulk-summary]');
      if (bulkSummary) bulkSummary.hidden = pendingRows.length === 0;
    }
    var empty = inbox.querySelector('[data-review-filter-empty]');
    if (empty) empty.hidden = visible.length > 0;
    var selected = visible.find(function (row) { return row.dataset.reviewSelect === inbox.dataset.reviewSelected; }) || visible[0];
    if (selected) showReviewDetail(inbox, selected.dataset.reviewSelect);
    else {
      inbox.dataset.reviewSelected = '';
      inbox.querySelectorAll('[data-review-detail]').forEach(function (detail) { detail.hidden = true; });
    }
  }

  function filterReviewQueue(inbox, filter) {
    inbox.dataset.reviewStatusFilter = filter;
    applyReviewFilters(inbox);
  }

  document.addEventListener('click', async function (event) {
    var button = event.target.closest('[data-document-review]');
    if (button && !button.disabled) {
      var code = button.dataset.documentCode;
      var decision = button.dataset.documentReview;
      if (!code || (decision !== 'approved' && decision !== 'rejected')) return;
      event.preventDefault();
      controlsFor(code).forEach(function (item) { item.disabled = true; });
      try {
        await reviewDocument(code, decision);
        refreshWorkspace();
      } catch (error) {
        controlsFor(code).forEach(function (item) { item.disabled = false; });
        window.alert(error.message || 'Unable to update document review.');
      }
      return;
    }

    var bulk = event.target.closest('[data-review-bulk]');
    if (bulk && !bulk.disabled) {
      event.preventDefault();
      var bulkInbox = bulk.closest('[data-review-inbox]');
      var bulkTopic = bulkInbox ? bulkInbox.dataset.reviewTopic || 'all' : 'all';
      var codes = Array.from((bulkInbox || document).querySelectorAll('[data-review-queue-row][data-review-status="pending"]')).filter(function (row) {
        return bulkTopic === 'all' || row.dataset.reviewTopic === bulkTopic;
      }).map(function (row) {
        return row.dataset.reviewSelect;
      }).filter(Boolean);
      bulk.disabled = true;
      try {
        for (var i = 0; i < codes.length; i += 1) await reviewDocument(codes[i], 'approved');
        refreshWorkspace();
      } catch (error) {
        window.alert(error.message || 'Unable to approve the passed documents.');
        refreshWorkspace();
      }
      return;
    }

    var filter = event.target.closest('button[data-review-filter]');
    if (filter) {
      var filterInbox = filter.closest('[data-review-inbox]');
      if (filterInbox) filterReviewQueue(filterInbox, filter.dataset.reviewFilter);
      return;
    }

    var row = event.target.closest('[data-review-select]');
    if (row) {
      var rowInbox = row.closest('[data-review-inbox]');
      if (rowInbox) showReviewDetail(rowInbox, row.dataset.reviewSelect);
      return;
    }

    var tab = event.target.closest('[data-review-tab]');
    if (tab) {
      var detail = tab.closest('[data-review-detail]');
      if (!detail) return;
      detail.querySelectorAll('[data-review-tab]').forEach(function (item) {
        var active = item === tab;
        item.classList.toggle('is-active', active);
        item.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      detail.querySelectorAll('[data-review-tab-panel]').forEach(function (panel) {
        panel.hidden = panel.dataset.reviewTabPanel !== tab.dataset.reviewTab;
      });
      event.preventDefault();
    }
  });

  document.addEventListener('change', function (event) {
    var topicPicker = event.target.closest('[data-review-topic-filter]');
    if (topicPicker) {
      var topicInbox = topicPicker.closest('[data-review-inbox]');
      if (topicInbox) {
        topicInbox.dataset.reviewTopic = topicPicker.value;
        applyReviewFilters(topicInbox);
      }
      return;
    }
    var picker = event.target.closest('[data-prompt-revision]');
    if (!picker) return;
    var targetId = picker.dataset.targetInput || 'forge-prompt-revision';
    var hidden = document.getElementById(targetId);
    if (hidden) hidden.value = picker.value;
  });
})();
