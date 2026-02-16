/**
 * Overlay timeline time-control API.
 * Usage (from overlay JS): window.__TIMELINE__.setTime(1.23)
 * Example include: <script src="/overlays/_timeline_api.js"></script>
 */
(function initTimelineApi(globalScope) {
  if (!globalScope || typeof globalScope !== "object") {
    return;
  }

  const existingTimeline = globalScope.__TIMELINE__;
  if (
    existingTimeline
    && typeof existingTimeline.setTime === "function"
    && typeof existingTimeline.getTime === "function"
  ) {
    if (typeof globalScope.setTimelineTime !== "function") {
      globalScope.setTimelineTime = (seconds) => existingTimeline.setTime(seconds);
    }
    return;
  }

  let timelineSeconds = 0;

  function clampSeconds(seconds) {
    const value = Number(seconds);
    if (!Number.isFinite(value)) {
      return timelineSeconds;
    }
    return Math.max(0, value);
  }

  function setCssTimelineVar(seconds) {
    const root = globalScope.document?.documentElement;
    if (!root || !root.style || typeof root.style.setProperty !== "function") {
      return;
    }
    root.style.setProperty("--tl-t", String(seconds));
  }

  function emitTimelineEvent(seconds) {
    if (typeof globalScope.dispatchEvent !== "function") {
      return;
    }
    const timelineEvent = new CustomEvent("timeline:time", { detail: { t: seconds } });
    globalScope.dispatchEvent(timelineEvent);
  }

  const timelineApi = {
    setTime(seconds) {
      timelineSeconds = clampSeconds(seconds);
      setCssTimelineVar(timelineSeconds);
      emitTimelineEvent(timelineSeconds);
      return timelineSeconds;
    },
    getTime() {
      return timelineSeconds;
    }
  };

  globalScope.__TIMELINE__ = timelineApi;
  globalScope.setTimelineTime = (seconds) => timelineApi.setTime(seconds);

  // Ensure overlays can read a deterministic default value immediately.
  setCssTimelineVar(timelineSeconds);
})(window);
