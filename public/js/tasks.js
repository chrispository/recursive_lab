/**
 * Benchmark task picker. The catalog is rendered server-side; filtering and
 * selection stay local so a large task list stays responsive without a round
 * trip.
 */
(function () {
  'use strict';

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
  });

  document.addEventListener('htmx:afterSwap', refreshTaskPicker);
  refreshTaskPicker();
})();
