/**
 * Program Monitor timeline core helpers.
 * Usage: import { compileTimeline } from "./timeline/core.js";
 */

const audioExt = [".mp3", ".wav", ".m4a", ".aac", ".ogg"];
const imageExt = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
const pageExt = [".html", ".htm"];
const videoExt = [".mp4", ".mov", ".webm", ".mkv"];

const DEFAULT_VERSION = 1;
const DEFAULT_NODE_DURATION_SECONDS = 4;

function getTypewriterDurationHintSeconds(params) {
  if (!params) {
    return 0;
  }

  const sentenceEntries = [];
  params.forEach((value, key) => {
    if (!value) {
      return;
    }
    if (/^s\d+$/i.test(key)) {
      sentenceEntries.push(value);
    }
  });

  if (!sentenceEntries.length) {
    return 0;
  }

  const cps = Number.parseFloat(params.get("cps") || "22");
  const inMs = Number.parseFloat(params.get("in") || "420");
  const outMs = Number.parseFloat(params.get("out") || "360");
  const holdMs = Number.parseFloat(params.get("hold") || "2600");
  const gapMs = Number.parseFloat(params.get("gap") || "320");
  const pauseMs = Number.parseFloat(params.get("pause") || "650");

  const safeCps = Number.isFinite(cps) && cps > 0 ? cps : 22;
  const safeIn = Number.isFinite(inMs) && inMs >= 0 ? inMs : 0;
  const safeOut = Number.isFinite(outMs) && outMs >= 0 ? outMs : 0;
  const safeHold = Number.isFinite(holdMs) && holdMs >= 0 ? holdMs : 0;
  const safeGap = Number.isFinite(gapMs) && gapMs >= 0 ? gapMs : 0;
  const safePause = Number.isFinite(pauseMs) && pauseMs >= 0 ? pauseMs : 0;

  const typingMs = sentenceEntries.reduce((total, sentence) => {
    const length = sentence.trim().length;
    return total + (length / safeCps) * 1000;
  }, 0);

  const sentenceCount = sentenceEntries.length;
  const gaps = sentenceCount > 1 ? safeGap * (sentenceCount - 1) : 0;
  const holds = safeHold * sentenceCount;
  const pauses = safePause * sentenceCount;

  const totalMs = safeIn + typingMs + pauses + holds + gaps + safeOut;
  if (!Number.isFinite(totalMs) || totalMs <= 0) {
    return 0;
  }

  return totalMs / 1000;
}

function extractPathname(url) {
  if (!url) {
    return "";
  }
  if (!url.includes("://")) {
    return String(url).toLowerCase();
  }
  try {
    return new URL(url).pathname.toLowerCase();
  } catch (error) {
    return String(url).toLowerCase();
  }
}

export function classifyUrl(url) {
  const lower = (url || "").toLowerCase();
  const path = extractPathname(lower);

  if (audioExt.some((ext) => path.endsWith(ext))) {
    return "audio";
  }
  if (imageExt.some((ext) => path.endsWith(ext))) {
    return "image";
  }
  if (pageExt.some((ext) => path.endsWith(ext))) {
    return "page";
  }
  if (videoExt.some((ext) => path.endsWith(ext))) {
    return "video";
  }
  return "video";
}

export function parseNodeText(text) {
  const rawLines = (text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("//") && !line.startsWith("#"));

  const explicitBaseIndex = rawLines.findIndex((line) => /^base\s*:/i.test(line));
  const lines = rawLines.map((line, index) => {
    if (index === explicitBaseIndex) {
      return line.replace(/^base\s*:/i, "").trim();
    }
    return line;
  });

  let baseIndex = 0;
  if (explicitBaseIndex >= 0) {
    baseIndex = explicitBaseIndex;
  } else if (lines.length > 1) {
    const nonAudioLines = lines.filter((line) => classifyUrl(line) !== "audio");
    const overlayLike = (line) => /\/overlays?\//i.test(line);
    const nonOverlayLines = nonAudioLines.filter((line) => !overlayLike(line));
    if (nonOverlayLines.length && lines.some(overlayLike)) {
      baseIndex = lines.lastIndexOf(nonOverlayLines[nonOverlayLines.length - 1]);
    }
  }

  const baseUrl = lines[baseIndex] || "";
  const layers = lines.filter((_, index) => index !== baseIndex);

  return {
    baseUrl,
    layers,
    lines,
    baseIndex,
    explicitBase: explicitBaseIndex >= 0
  };
}

export function getDurationHintSeconds(url) {
  if (!url) {
    return 0;
  }

  let parsed;
  try {
    parsed = url.includes("://") ? new URL(url) : new URL(url, "http://localhost");
  } catch (error) {
    return 0;
  }

  const params = parsed.searchParams;
  if (!params || Array.from(params.keys()).length === 0) {
    return 0;
  }

  const secondsKeys = new Set(["duration", "dur", "length", "len", "time", "t", "seconds", "sec", "s"]);
  const msKeys = new Set(["ms", "msec", "millis", "milliseconds"]);
  const componentMsKeys = new Set(["in", "out", "hold", "gap", "pause", "delay", "start", "intro", "outro", "spin", "loop", "dwell"]);

  for (const key of secondsKeys) {
    const value = params.get(key);
    if (!value) {
      continue;
    }
    const parsedValue = Number.parseFloat(value);
    if (Number.isFinite(parsedValue) && parsedValue > 0) {
      return parsedValue >= 1000 ? parsedValue / 1000 : parsedValue;
    }
  }

  for (const key of msKeys) {
    const value = params.get(key);
    if (!value) {
      continue;
    }
    const parsedValue = Number.parseFloat(value);
    if (Number.isFinite(parsedValue) && parsedValue > 0) {
      return parsedValue / 1000;
    }
  }

  let totalMs = 0;
  params.forEach((value, rawKey) => {
    const key = rawKey.toLowerCase();
    const baseKey = key.replace(/\d+$/, "");
    if (!componentMsKeys.has(baseKey)) {
      return;
    }
    const parsedValue = Number.parseFloat(value);
    if (Number.isFinite(parsedValue) && parsedValue > 0) {
      totalMs += parsedValue;
    }
  });

  if (totalMs > 0) {
    return Math.max(totalMs / 1000, getTypewriterDurationHintSeconds(params));
  }

  const typewriterHint = getTypewriterDurationHintSeconds(params);
  if (typewriterHint > 0) {
    return typewriterHint;
  }

  return 0;
}

export function encodeTimelinePayload(payload) {
  if (payload === undefined) {
    return "";
  }
  try {
    const json = JSON.stringify(payload);
    if (typeof Buffer !== "undefined") {
      return Buffer.from(json, "utf8").toString("base64");
    }
    if (typeof window !== "undefined" && typeof window.btoa === "function") {
      const encoder = new TextEncoder();
      const bytes = encoder.encode(json);
      let binary = "";
      bytes.forEach((value) => {
        binary += String.fromCharCode(value);
      });
      return window.btoa(binary);
    }
    return "";
  } catch (error) {
    return "";
  }
}

export function decodeTimelinePayload(value) {
  if (!value) {
    return null;
  }
  try {
    let json = "";
    if (typeof Buffer !== "undefined") {
      json = Buffer.from(value, "base64").toString("utf8");
    } else if (typeof window !== "undefined" && typeof window.atob === "function") {
      const binary = window.atob(value);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      const decoder = new TextDecoder("utf-8");
      json = decoder.decode(bytes);
    }
    return json ? JSON.parse(json) : null;
  } catch (error) {
    return null;
  }
}

export function buildNodeDescriptor(node) {
  const text = node && node.text ? String(node.text) : "";
  const parsed = parseNodeText(text);
  const baseUrl = parsed.baseUrl || "";
  const baseKind = baseUrl ? classifyUrl(baseUrl) : "unknown";
  const overlays = [];
  const ambient = [];

  parsed.layers.forEach((url) => {
    const kind = classifyUrl(url);
    if (kind === "audio") {
      ambient.push({ url, kind });
      return;
    }
    overlays.push({ url, kind });
  });

  return {
    id: node && node.id ? node.id : "",
    text,
    durationOverride: node && node.durationOverride ? node.durationOverride : "",
    base: { url: baseUrl, kind: baseKind },
    overlays,
    ambient
  };
}

export function buildTimelineDescriptor(timeline) {
  const safeTimeline = timeline || { nodes: [], activeIndex: 0 };
  const nodes = Array.isArray(safeTimeline.nodes) ? safeTimeline.nodes : [];
  const activeIndex = Number.isFinite(safeTimeline.activeIndex) ? safeTimeline.activeIndex : 0;

  return {
    version: Number.isFinite(safeTimeline.version) ? safeTimeline.version : DEFAULT_VERSION,
    activeIndex,
    nodes,
    nodesStructured: nodes.map((node) => buildNodeDescriptor(node))
  };
}

function resolveNodeDurationSeconds(node, descriptor) {
  const overrideSeconds = Number(node?.durationOverride);
  if (Number.isFinite(overrideSeconds) && overrideSeconds > 0) {
    return overrideSeconds;
  }

  const hintSeconds = getDurationHintSeconds(descriptor.base.url);
  if (descriptor.base.kind === "page") {
    return Number.isFinite(hintSeconds) && hintSeconds > 0 ? hintSeconds : 0;
  }

  if (Number.isFinite(hintSeconds) && hintSeconds > 0) {
    return hintSeconds;
  }

  return DEFAULT_NODE_DURATION_SECONDS;
}

export function compileTimeline({ timeline, fps, width, height }) {
  const descriptor = buildTimelineDescriptor(timeline || { version: DEFAULT_VERSION, nodes: [], activeIndex: 0 });
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 60;
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 1080;
  const safeHeight = Number.isFinite(height) && height > 0 ? height : 1920;
  const safeActiveIndex = Math.max(0, Math.min(descriptor.activeIndex, Math.max(descriptor.nodes.length - 1, 0)));

  const nodes = descriptor.nodes.map((node, index) => {
    const structured = descriptor.nodesStructured[index] || buildNodeDescriptor(node);
    const duration = resolveNodeDurationSeconds(node, structured);
    const layers = [
      { ...structured.base, role: "base" },
      ...structured.overlays.map((layer) => ({ ...layer, role: "overlay" })),
      ...structured.ambient.map((layer) => ({ ...layer, role: "ambient" }))
    ].filter((layer) => layer.url);

    return {
      id: structured.id || `node-${index + 1}`,
      duration,
      base: structured.base,
      layers,
      metadata: {
        durationOverride: structured.durationOverride || "",
        text: structured.text
      }
    };
  });

  return {
    version: descriptor.version,
    fps: safeFps,
    width: safeWidth,
    height: safeHeight,
    activeIndex: safeActiveIndex,
    metadata: {
      source: "program-monitor.timeline.core"
    },
    nodes
  };
}
