/**
 * Topic Dial shared helpers.
 * Usage (browser): window.TopicDialLogic.buildTopicsFromParams({ params, defaults: ["A", "B"] });
 * Usage (node): const { buildTopicsFromParams } = require("./topic_dial_custom_logic.js");
 * Example: node --test site/overlays/topic_dial_custom_logic.test.js
 */
function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function formatTopicDisplay(value) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  return text.length ? text.toUpperCase() : "—";
}

function splitLabelsString(value) {
  if (!value) return [];
  const raw = String(value).trim();
  if (!raw) return [];
  const parts = raw.includes("|") ? raw.split("|") : raw.split(",");
  return parts.map((part) => part.trim()).filter(Boolean);
}

function buildTopicsFromParams({ params, defaults, maxCount = 24 }) {
  const safeDefaults = Array.isArray(defaults) && defaults.length ? defaults : ["TOPIC"];
  const nRaw = params?.n;
  const n = nRaw != null ? clamp(parseInt(nRaw, 10) || 0, 1, maxCount) : null;

  let fromLabels = splitLabelsString(params?.labels);

  const cap = n ?? Math.max(fromLabels.length, safeDefaults.length, 1);
  const slotOverrides = [];
  for (let i = 1; i <= cap; i += 1) {
    const override = params?.t ? params.t(i) : null;
    if (override != null && String(override).trim().length) {
      slotOverrides[i - 1] = String(override).trim();
    }
  }

  let topics = fromLabels.length ? [...fromLabels] : [...safeDefaults];

  if (slotOverrides.length) {
    const needLen = Math.max(topics.length, slotOverrides.length);
    if (topics.length < needLen) {
      for (let i = topics.length; i < needLen; i += 1) {
        topics[i] = safeDefaults[i % safeDefaults.length];
      }
    }
    for (let i = 0; i < slotOverrides.length; i += 1) {
      if (slotOverrides[i] != null && String(slotOverrides[i]).trim().length) {
        topics[i] = slotOverrides[i];
      }
    }
  }

  if (n != null) {
    if (topics.length > n) topics = topics.slice(0, n);
    if (topics.length < n) {
      for (let i = topics.length; i < n; i += 1) {
        topics.push(safeDefaults[i % safeDefaults.length]);
      }
    }
  }

  topics = topics.map(formatTopicDisplay);
  return topics.length ? topics : safeDefaults.map(formatTopicDisplay);
}

function parseLandingIndex(value, maxCount) {
  if (value == null) return null;
  const cleaned = String(value).trim().toLowerCase();
  if (!cleaned || cleaned === "random" || cleaned === "auto" || cleaned === "off") return null;
  const num = parseInt(cleaned, 10);
  if (!Number.isFinite(num) || num <= 0) return null;
  if (Number.isFinite(maxCount)) {
    return clamp(num, 1, maxCount);
  }
  return num;
}

if (typeof window !== "undefined") {
  window.TopicDialLogic = {
    clamp,
    formatTopicDisplay,
    splitLabelsString,
    buildTopicsFromParams,
    parseLandingIndex
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    clamp,
    formatTopicDisplay,
    splitLabelsString,
    buildTopicsFromParams,
    parseLandingIndex
  };
}
