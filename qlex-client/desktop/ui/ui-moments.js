"use strict";

/* QLEX UI Moments — tactile micro-interaction engine inspired by guanmo-ai/ui-moments (MIT)
   Zero dependencies · Strict offline CSP compatible · Respects prefers-reduced-motion */
(() => {
  const reducedMotion = () =>
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Persist last sliding-pill geometry by container element across patchHtml re-renders
  const sliderMemory = new WeakMap();
  const groupMemory = new Map();
  let syncScheduled = false;

  const SLIDER_CONFIGS = [
    { selector: ".seg-bar", item: ".seg-btn", active: ".seg-btn.active", axis: "x" },
    { selector: ".dash-tabs", item: ".dash-tab", active: ".dash-tab.active", axis: "x" },
    { selector: ".dash-range-group", item: ".range-btn", active: ".range-btn.active", axis: "x" },
    { selector: ".nav-capsule", item: ".nav-capsule-btn", active: ".nav-capsule-btn.active", axis: "y" },
  ];

  function getContainerKey(container) {
    if (container.dataset.umGroup) return `g:${container.dataset.umGroup}`;
    if (container.id) return `id:${container.id}`;
    return null;
  }

  function isMultiRowWrap(container, items) {
    if (items.length < 2) return false;
    const firstTop = items[0].offsetTop;
    for (let i = 1; i < items.length; i++) {
      if (Math.abs(items[i].offsetTop - firstTop) > 6) return true;
    }
    return false;
  }

  function ensureSliderPill(container) {
    let pill = container.querySelector(":scope > .um-slide-pill");
    if (!pill) {
      pill = document.createElement("span");
      pill.className = "um-slide-pill";
      pill.setAttribute("aria-hidden", "true");
      container.prepend(pill);
    }
    return pill;
  }

  function positionSlider(container, cfg) {
    const items = Array.from(container.querySelectorAll(`:scope > ${cfg.item}`));
    const active = container.querySelector(`:scope > ${cfg.active}`);
    if (!items.length || !active) {
      container.classList.remove("um-has-slider");
      const old = container.querySelector(":scope > .um-slide-pill");
      if (old) old.style.opacity = "0";
      return;
    }

    // If horizontal bar wrapped onto multiple rows, fall back gracefully to native .active background
    if (cfg.axis === "x" && isMultiRowWrap(container, items)) {
      container.classList.remove("um-has-slider");
      const old = container.querySelector(":scope > .um-slide-pill");
      if (old) old.style.opacity = "0";
      return;
    }

    const w = active.offsetWidth;
    const h = active.offsetHeight;
    if (w <= 0 || h <= 0) return;

    const x = active.offsetLeft;
    const y = active.offsetTop;

    const pill = ensureSliderPill(container);
    container.classList.add("um-has-slider");

    const key = getContainerKey(container);
    const prev = sliderMemory.get(container) || (key ? groupMemory.get(key) : null);
    const next = { x, y, w, h };

    const applyRect = (r, animate) => {
      if (!animate || reducedMotion()) {
        pill.style.transition = "none";
      } else {
        pill.style.transition = "";
      }
      pill.style.width = `${r.w}px`;
      pill.style.height = `${r.h}px`;
      pill.style.transform = `translate3d(${r.x}px, ${r.y}px, 0)`;
      pill.style.opacity = "1";
    };

    const moved = !prev || Math.abs(prev.x - x) > 0.5 || Math.abs(prev.y - y) > 0.5 || Math.abs(prev.w - w) > 0.5 || Math.abs(prev.h - h) > 0.5;

    if (!prev) {
      applyRect(next, false);
      // Force layout flush so future moves animate smoothly
      void pill.offsetWidth;
      pill.style.transition = "";
    } else if (moved) {
      // If pill was freshly mounted after innerHTML replacement, seed from previous geometry first
      if (!pill.dataset.umReady) {
        applyRect(prev, false);
        void pill.offsetWidth;
      }
      applyRect(next, true);
    } else {
      applyRect(next, false);
    }

    pill.dataset.umReady = "1";
    sliderMemory.set(container, next);
    if (key) groupMemory.set(key, next);
  }

  function syncSliders() {
    for (const cfg of SLIDER_CONFIGS) {
      const containers = document.querySelectorAll(cfg.selector);
      for (const el of containers) {
        positionSlider(el, cfg);
      }
    }
  }

  function updateRangeVisual(input) {
    if (!input || input.type !== "range") return;
    const min = Number(input.min === "" ? 0 : input.min);
    const max = Number(input.max === "" ? 100 : input.max);
    const val = Number(input.value === "" ? min : input.value);
    const pct = max > min ? ((val - min) / (max - min)) * 100 : 0;
    input.style.setProperty("--um-pct", `${Math.max(0, Math.min(100, pct)).toFixed(2)}%`);
  }

  function syncRanges() {
    const ranges = document.querySelectorAll('input[type="range"].glass-range');
    for (const input of ranges) {
      updateRangeVisual(input);
    }
  }

  function syncAll() {
    syncRanges();
    syncSliders();
  }

  function scheduleSync() {
    if (syncScheduled) return;
    syncScheduled = true;
    requestAnimationFrame(() => {
      syncScheduled = false;
      syncAll();
    });
  }

  // Copy Morph animation (clipboard -> animated check + vertical text swap)
  function triggerCopyFeedback(btn, durationMs = 1600) {
    if (!btn) return;
    btn.classList.add("copied");
    btn.setAttribute("data-copied", "true");
    clearTimeout(btn.__umCopyTimer);
    btn.__umCopyTimer = setTimeout(() => {
      btn.classList.remove("copied");
      btn.removeAttribute("data-copied");
    }, durationMs);
  }

  // Tactile range drag tracking + live progress fill
  document.addEventListener("input", (event) => {
    const input = event.target;
    if (input instanceof HTMLInputElement && input.type === "range" && input.classList.contains("glass-range")) {
      updateRangeVisual(input);
    }
  }, true);

  let activeRange = null;
  document.addEventListener("pointerdown", (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.type === "range" && target.classList.contains("glass-range")) {
      activeRange = target;
      target.dataset.drag = "true";
      updateRangeVisual(target);
      return;
    }

    // Subtle pointer-origin specular light feedback on pill/tactile buttons
    const btn = target instanceof Element
      ? target.closest(".glass-btn, .hub-quick-btn, .sync-pill, .version-pill, .mb-mini-btn, .mb-upd-cta, .icon-button, .quick-action-btn, #open")
      : null;
    if (btn && !btn.disabled && !reducedMotion()) {
      const rect = btn.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const px = ((event.clientX - rect.left) / rect.width) * 100;
        const py = ((event.clientY - rect.top) / rect.height) * 100;
        btn.style.setProperty("--um-x", `${Math.max(0, Math.min(100, px)).toFixed(1)}%`);
        btn.style.setProperty("--um-y", `${Math.max(0, Math.min(100, py)).toFixed(1)}%`);
        btn.classList.remove("um-pulse");
        void btn.offsetWidth;
        btn.classList.add("um-pulse");
        clearTimeout(btn.__umPulseTimer);
        btn.__umPulseTimer = setTimeout(() => btn.classList.remove("um-pulse"), 420);
      }
    }
  }, true);

  const endRangeDrag = () => {
    if (activeRange) {
      delete activeRange.dataset.drag;
      activeRange = null;
    }
  };
  window.addEventListener("pointerup", endRangeDrag, true);
  window.addEventListener("pointercancel", endRangeDrag, true);
  window.addEventListener("blur", endRangeDrag);

  // Secret input eye-slash toggle (inspired by ui-moments Strength Meter)
  document.addEventListener("click", (event) => {
    const toggle = event.target instanceof Element ? event.target.closest("[data-toggle-secret]") : null;
    if (!toggle) return;
    const selector = toggle.getAttribute("data-toggle-secret");
    const field = toggle.closest(".secret-field");
    const input = (selector ? document.querySelector(selector) : null) || field?.querySelector("input");
    if (!input) return;
    const reveal = input.type === "password";
    input.type = reveal ? "text" : "password";
    toggle.setAttribute("aria-pressed", reveal ? "true" : "false");
    toggle.setAttribute("title", reveal ? "隐藏密钥" : "显示密钥");
    input.focus();
  });

  // Observe dynamic UI mutations & resizes to keep sliding pills & range bars in sync
  const observer = new MutationObserver(() => scheduleSync());
  window.addEventListener("resize", scheduleSync);

  function init() {
    if (document.body) {
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "hidden"],
      });
    }
    syncAll();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }

  window.QlexMoments = {
    sync: syncAll,
    scheduleSync,
    syncSliders,
    syncRanges,
    triggerCopyFeedback,
  };
})();
