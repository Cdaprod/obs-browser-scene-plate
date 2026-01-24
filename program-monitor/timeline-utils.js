/**
 * Program Monitor timeline helpers.
 * Usage (browser): window.ProgramMonitorUtils.parseNodeText(...)
 * Usage (node): node --test program-monitor/timeline-utils.test.mjs
 */

(function setupProgramMonitorUtils(globalScope) {
  const AUDIO_EXTENSIONS = [".mp3", ".wav", ".m4a", ".aac", ".ogg"];
  const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
  const PAGE_EXTENSIONS = [".html", ".htm"];
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
    if (PAGE_EXTENSIONS.some((ext) => path.endsWith(ext))) {
      return "page";
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

  function uuid() {
    if (globalScope && globalScope.crypto && typeof globalScope.crypto.randomUUID === "function") {
      return globalScope.crypto.randomUUID();
    }

    if (globalScope && globalScope.crypto && typeof globalScope.crypto.getRandomValues === "function") {
      const bytes = new Uint8Array(16);
      globalScope.crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes)
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }

    return `id_${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`;
  }

  const api = {
    STORAGE_KEY,
    parseNodeText,
    classifyUrl,
    isHttpUrl,
    uuid
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  if (globalScope) {
    globalScope.ProgramMonitorUtils = api;
  }
})(typeof window !== "undefined" ? window : global);
