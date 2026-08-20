/**
 * After a run starts, fold the benchmark configuration so the ledger is on
 * screen. Gear clicks must not toggle the <details> they live in.
 */
(function () {
  'use strict';

  function reducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /** The fold duration, defined once in benchmarks.css as --collapse-ms. */
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
