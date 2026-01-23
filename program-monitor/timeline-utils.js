/**
 * Program Monitor timeline helpers.
 * Usage (browser): import { parseNodeText } from "./timeline-utils.js";
 * Usage (node): node --test program-monitor/timeline-utils.test.mjs
 */

const AUDIO_EXTENSIONS = [".mp3", ".wav", ".m4a", ".aac", ".ogg"];
const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
const VIDEO_EXTENSIONS = [".mp4", ".mov", ".webm", ".mkv"];

export const STORAGE_KEY = "program-monitor.timeline.v1";

export function parseNodeText(text) {
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

export function classifyUrl(url) {
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

export function isHttpUrl(url) {
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
