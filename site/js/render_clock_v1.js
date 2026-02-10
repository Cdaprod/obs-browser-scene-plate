/**
 * render_clock_v1.js
 *
 * Lightweight frame-locked render clock helper for HTML overlays.
 *
 * Usage:
 *   <script src="/js/render_clock_v1.js"></script>
 *
 * Example:
 *   // CSS: opacity: calc(min(1, var(--t) / 0.4));
 *   // JS: if (RenderClock.state.tMs > 2400) showNextLine();
 */
(function initRenderClockV1() {
  const state = {
    fps: 60,
    frames: 0,
    tMs: 0,
    durMs: 0,
    frame: 0,
    driven: false
  };

  function setVar(key, value) {
    document.documentElement.style.setProperty(key, String(value));
  }

  function apply(ms, frame, frames, fps) {
    state.driven = true;
    state.tMs = ms;
    state.frame = frame;
    state.frames = frames;
    state.fps = fps;
    state.durMs = window.__RENDER_DUR_MS || state.durMs;

    setVar("--t-ms", ms);
    setVar("--t", (ms / 1000).toFixed(6));
    if (frames > 1) {
      setVar("--p", (frame / (frames - 1)).toFixed(6));
    }
  }

  if (typeof window.__SET_RENDER_TIME !== "function") {
    window.__SET_RENDER_TIME = (ms) => {
      apply(ms, state.frame, state.frames || 1, state.fps || 60);
    };
  }

  if (typeof window.__RENDER_SET_FRAME !== "function") {
    window.__RENDER_SET_FRAME = (i, frames, fps) => {
      state.frame = i;
      state.frames = frames;
      state.fps = fps;
      const ms = Math.round((i * 1000) / fps);
      apply(ms, i, frames, fps);
    };
  }

  window.RenderClock = {
    apply,
    state,
    markReady() {
      window.__RENDER_READY = true;
    }
  };

  window.addEventListener("load", () => {
    if (window.__RENDER_READY !== true) {
      window.__RENDER_READY = true;
    }
  });
})();
