(() => {
  const $ = (id) => document.getElementById(id);

  function setChoice(attr, selected) {
    document.querySelectorAll(`[${attr}]`).forEach((button) => {
      button.setAttribute("aria-pressed", String(button.getAttribute(attr) === selected));
    });
  }

  function applyTheme(theme, persist = true) {
    const selected = theme === "light" ? "light" : "dark";
    document.documentElement.dataset.theme = selected;
    setChoice("data-theme-choice", selected);
    if (persist) localStorage.setItem("recursive-theme", selected);
  }

  function applyDensity(density, persist = true) {
    const selected = density === "compact" ? "compact" : "comfort";
    document.documentElement.dataset.density = selected;
    setChoice("data-density-choice", selected);
    if (persist) localStorage.setItem("recursive-density", selected);
  }

  applyTheme(document.documentElement.dataset.theme, false);
  applyDensity(document.documentElement.dataset.density || "comfort", false);

  function setPrefsOpen(open) {
    const popout = $("prefs-popout");
    const trigger = $("prefs-open");
    if (!popout || !trigger) return;
    popout.hidden = !open;
    trigger.setAttribute("aria-expanded", String(open));
    trigger.classList.toggle("active", open);
  }

  $("prefs-open")?.addEventListener("click", (event) => {
    event.stopPropagation();
    setPrefsOpen($("prefs-popout").hidden);
  });
  $("prefs-popout")?.addEventListener("click", (event) => {
    const theme = event.target.closest("[data-theme-choice]");
    if (theme) applyTheme(theme.dataset.themeChoice);
    const density = event.target.closest("[data-density-choice]");
    if (density) applyDensity(density.dataset.densityChoice);
    if (event.target.closest(".popout-item")) setPrefsOpen(false);
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".popout-anchor")) setPrefsOpen(false);
  });

  const recurse = $("recurse-button");
  const holdMs = 1400;
  let frame = null;
  let started = 0;
  function progress(value) {
    recurse?.style.setProperty("--recurse-progress", `${Math.max(0, Math.min(100, value))}%`);
  }
  function reset() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    started = 0;
    progress(0);
  }
  function tick(now) {
    const pct = ((now - started) / holdMs) * 100;
    progress(pct);
    if (pct < 100) frame = requestAnimationFrame(tick);
  }
  if (recurse) {
    recurse.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || recurse.disabled) return;
      event.preventDefault();
      recurse.setPointerCapture?.(event.pointerId);
      reset();
      started = performance.now();
      frame = requestAnimationFrame(tick);
    });
    recurse.addEventListener("pointerup", reset);
    recurse.addEventListener("pointercancel", reset);
    recurse.addEventListener("lostpointercapture", reset);
  }
})();
