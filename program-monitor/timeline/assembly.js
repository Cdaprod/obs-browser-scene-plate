/**
 * Timeline assembly helpers for selected media-sync assets.
 * Usage:
 *   import { buildAssembledClips, clipsToImportNodes } from "./timeline/assembly.js";
 * Example:
 *   const clips = buildAssembledClips({ items: [{ asset_id: "sha256:...", creation_time: "2026-01-01T00:00:00Z" }] }, { mode: "sequence" });
 */

const DEFAULT_CLIP_DURATION_SECONDS = 5;

function asTime(value) {
  if (!value) return Number.NaN;
  const t = Date.parse(String(value));
  return Number.isFinite(t) ? t : Number.NaN;
}

function safeDuration(value, fallback = DEFAULT_CLIP_DURATION_SECONDS) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function normalizeAssetId(value) {
  const text = String(value || "").trim();
  if (/^sha256:[a-f0-9]{64}$/i.test(text)) {
    return text.toLowerCase();
  }
  if (/^[a-f0-9]{64}$/i.test(text)) {
    return `sha256:${text.toLowerCase()}`;
  }
  return "";
}

function normalizeItems(payload) {
  if (!payload || typeof payload !== "object") {
    return [];
  }
  if (Array.isArray(payload.items)) {
    return payload.items.map((item) => ({
      asset_id: normalizeAssetId(item?.asset_id || item?.sha256 || ""),
      url: String(item?.url || item?.fallback_url || item?.fallback_path || "").trim(),
      creation_time: String(item?.creation_time || item?.timestamps?.creation_time || "").trim(),
      origin: String(item?.origin || "unknown").trim().toLowerCase() || "unknown",
      duration: safeDuration(item?.duration, DEFAULT_CLIP_DURATION_SECONDS)
    })).filter((item) => item.asset_id || item.url);
  }

  const ids = Array.isArray(payload.asset_ids) ? payload.asset_ids : [];
  const fallback = payload.fallback_paths && typeof payload.fallback_paths === "object" ? payload.fallback_paths : {};
  const origins = payload.origins && typeof payload.origins === "object" ? payload.origins : {};
  const creationTimes = payload.creation_times && typeof payload.creation_times === "object" ? payload.creation_times : {};

  return ids.map((id) => {
    const asset_id = normalizeAssetId(id);
    return {
      asset_id,
      url: String(fallback[id] || fallback[asset_id] || "").trim(),
      creation_time: String(creationTimes[id] || creationTimes[asset_id] || "").trim(),
      origin: String(origins[id] || origins[asset_id] || "unknown").trim().toLowerCase() || "unknown",
      duration: DEFAULT_CLIP_DURATION_SECONDS
    };
  }).filter((item) => item.asset_id || item.url);
}

function stableSortItems(items) {
  return [...items].sort((a, b) => {
    const ta = asTime(a.creation_time);
    const tb = asTime(b.creation_time);
    if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
    if (Number.isFinite(ta) && !Number.isFinite(tb)) return -1;
    if (!Number.isFinite(ta) && Number.isFinite(tb)) return 1;
    const aa = a.asset_id || a.url;
    const bb = b.asset_id || b.url;
    return aa.localeCompare(bb);
  });
}

export function buildAssembledClips(payload, { mode = "sequence", defaultDuration = DEFAULT_CLIP_DURATION_SECONDS } = {}) {
  const items = normalizeItems(payload);
  if (!items.length) return [];

  if (String(mode).toLowerCase() === "multicam") {
    const sorted = stableSortItems(items);
    const anchorMs = asTime(sorted.find((item) => Number.isFinite(asTime(item.creation_time)))?.creation_time);
    const origins = Array.from(new Set(sorted.map((item) => item.origin || "unknown"))).sort();
    const trackByOrigin = new Map(origins.map((origin, index) => [origin, index + 1]));
    return sorted.map((item, index) => {
      const startMs = asTime(item.creation_time);
      const start = Number.isFinite(anchorMs) && Number.isFinite(startMs)
        ? Math.max(0, (startMs - anchorMs) / 1000)
        : index * 0.01;
      return {
        id: `clip-${index + 1}`,
        kind: "video",
        ref: { asset_id: item.asset_id, url: item.url },
        start,
        duration: safeDuration(item.duration, defaultDuration),
        in: 0,
        track: trackByOrigin.get(item.origin || "unknown") || 1,
        origin: item.origin || "unknown",
        creation_time: item.creation_time || ""
      };
    });
  }

  const sorted = stableSortItems(items);
  let cursor = 0;
  return sorted.map((item, index) => {
    const duration = safeDuration(item.duration, defaultDuration);
    const clip = {
      id: `clip-${index + 1}`,
      kind: "video",
      ref: { asset_id: item.asset_id, url: item.url },
      start: cursor,
      duration,
      in: 0,
      track: 1,
      origin: item.origin || "unknown",
      creation_time: item.creation_time || ""
    };
    cursor += duration;
    return clip;
  });
}

export function clipsToImportNodes(clips) {
  if (!Array.isArray(clips) || !clips.length) return [];
  return [...clips]
    .sort((a, b) => a.start - b.start || a.track - b.track)
    .map((clip, index) => {
      const ref = clip?.ref || {};
      const line = ref.asset_id && ref.url
        ? `${ref.asset_id}|${ref.url}`
        : (ref.asset_id || ref.url || "");
      return {
        id: `node-${index + 1}`,
        text: line,
        durationOverride: String(safeDuration(clip.duration, DEFAULT_CLIP_DURATION_SECONDS))
      };
    })
    .filter((node) => Boolean(node.text));
}

export function buildAssemblySpec(payload, options = {}) {
  return {
    source: "media-sync-selection",
    mode: String(options.mode || "sequence").toLowerCase(),
    imported_at: new Date().toISOString(),
    item_count: normalizeItems(payload).length
  };
}
