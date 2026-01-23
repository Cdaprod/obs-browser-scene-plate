/**
 * Program Monitor timeline helpers.
 * Usage (browser): window.ProgramMonitorUtils.parseNodeText(...)
 * Usage (node): node --test program-monitor/timeline-utils.test.mjs
 */

(function setupProgramMonitorUtils(globalScope) {
  const AUDIO_EXTENSIONS = [".mp3", ".wav", ".m4a", ".aac", ".ogg"];
  const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
  const VIDEO_EXTENSIONS = [".mp4", ".mov", ".webm", ".mkv"];
  const STORAGE_KEY = "program-monitor.timeline.v1";

  function parseNodeText(text) {
    const lines = (text || "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("//") && !line.startsWith("#"));

    return {
      baseUrl: lines[0] || "",
      layers: lines.slice(1),
      lines
    };
  }

  function classifyUrl(url) {
    const lower = (url || "").toLowerCase();
    const path = extractPathname(lower);

    if (AUDIO_EXTENSIONS.some((ext) => path.endsWith(ext))) {
      return "audio";
    }

    if (IMAGE_EXTENSIONS.some((ext) => path.endsWith(ext))) {
      return "image";
    }

    if (VIDEO_EXTENSIONS.some((ext) => path.endsWith(ext))) {
      return "video";
    }

    return "video";
  }

  function isHttpUrl(url) {
    return /^https?:\/\//i.test(url || "");
  }

  function extractPathname(url) {
    if (!url) {
      return "";
    }

    if (!url.includes("://")) {
      return url;
    }

    try {
      return new URL(url).pathname.toLowerCase();
    } catch (error) {
      return url;
    }
  }

  const api = {
    STORAGE_KEY,
    parseNodeText,
    classifyUrl,
    isHttpUrl
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  if (globalScope) {
    globalScope.ProgramMonitorUtils = api;
  }
})(typeof window !== "undefined" ? window : global);
