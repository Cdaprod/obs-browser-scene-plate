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

function anchorTimeForItem(item) {
  return String(item?.timeline?.anchor_time || item?.creation_time || item?.timestamps?.creation_time || "").trim();
}

function durationForItem(item) {
  return safeDuration(
    item?.facts?.duration_seconds
    ?? item?.duration_seconds
    ?? item?.duration,
    DEFAULT_CLIP_DURATION_SECONDS
  );
}

function normalizeItems(payload) {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  if (Array.isArray(payload.items)) {
    return payload.items.map((item) => {
      const assetId = normalizeAssetId(item?.asset_id || item?.sha256 || "");
      const fallbackPath = String(item?.fallback_path || item?.relative_path || "").trim();
      const streamUrl = String(item?.stream_url || item?.urls?.stream || item?.url || "").trim();
      return {
        asset_id: assetId,
        sha256: assetId ? assetId.replace(/^sha256:/, "") : String(item?.sha256 || "").trim().toLowerCase(),
        url: streamUrl,
        fallback_path: fallbackPath,
        creation_time: String(item?.creation_time || item?.timestamps?.creation_time || "").trim(),
        timeline: item?.timeline || null,
        origin: String(item?.origin || "unknown").trim().toLowerCase() || "unknown",
        facts: item?.facts || null,
        duration: durationForItem(item)
      };
    }).filter((item) => item.asset_id || item.url || item.fallback_path);
  }

  const ids = Array.isArray(payload.asset_ids) ? payload.asset_ids : [];
  const fallback = payload.fallback_paths && typeof payload.fallback_paths === "object" ? payload.fallback_paths : {};
  const origins = payload.origins && typeof payload.origins === "object" ? payload.origins : {};
  const creationTimes = payload.creation_times && typeof payload.creation_times === "object" ? payload.creation_times : {};
  const durations = payload.duration_seconds && typeof payload.duration_seconds === "object" ? payload.duration_seconds : {};

  return ids.map((id) => {
    const asset_id = normalizeAssetId(id);
    return {
      asset_id,
      sha256: asset_id ? asset_id.replace(/^sha256:/, "") : "",
      url: String(fallback[id] || fallback[asset_id] || "").trim(),
      fallback_path: "",
      creation_time: String(creationTimes[id] || creationTimes[asset_id] || "").trim(),
      timeline: null,
      origin: String(origins[id] || origins[asset_id] || "unknown").trim().toLowerCase() || "unknown",
      facts: { duration_seconds: safeDuration(durations[id] || durations[asset_id], DEFAULT_CLIP_DURATION_SECONDS) },
      duration: safeDuration(durations[id] || durations[asset_id], DEFAULT_CLIP_DURATION_SECONDS)
    };
  }).filter((item) => item.asset_id || item.url);
}

function stableSortItems(items) {
  return [...items].sort((a, b) => {
    const ta = asTime(anchorTimeForItem(a));
    const tb = asTime(anchorTimeForItem(b));
    if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
    if (Number.isFinite(ta) && !Number.isFinite(tb)) return -1;
    if (!Number.isFinite(ta) && Number.isFinite(tb)) return 1;
    const aa = a.asset_id || a.url || a.fallback_path;
    const bb = b.asset_id || b.url || b.fallback_path;
    return aa.localeCompare(bb);
  });
}

export function buildAssembledClips(payload, { mode = "sequence", defaultDuration = DEFAULT_CLIP_DURATION_SECONDS } = {}) {
  const items = normalizeItems(payload);
  if (!items.length) return [];

  const normalizedMode = String(mode).toLowerCase();
  if (normalizedMode === "multicam") {
    const sorted = stableSortItems(items);
    const anchorMs = asTime(anchorTimeForItem(sorted.find((item) => Number.isFinite(asTime(anchorTimeForItem(item))))));
    const origins = Array.from(new Set(sorted.map((item) => item.origin || "unknown"))).sort();
    const trackByOrigin = new Map(origins.map((origin, index) => [origin, index + 1]));

    return sorted.map((item, index) => {
      const itemAnchor = anchorTimeForItem(item);
      const startMs = asTime(itemAnchor);
      const start = Number.isFinite(anchorMs) && Number.isFinite(startMs)
        ? Math.max(0, (startMs - anchorMs) / 1000)
        : index * 0.01;
      const duration = safeDuration(item.duration, defaultDuration);
      return {
        id: `clip-${index + 1}`,
        kind: "video",
        ref: {
          asset_id: item.asset_id,
          sha256: item.sha256,
          url: item.url,
          fallback_url: item.url,
          fallback_path: item.fallback_path
        },
        start,
        duration,
        in: 0,
        track: trackByOrigin.get(item.origin || "unknown") || 1,
        origin: item.origin || "unknown",
        creation_time: item.creation_time || "",
        timeline: item.timeline || { anchor_time: itemAnchor || null, anchor_source: "unknown", confidence: 0 },
        facts: item.facts || { duration_seconds: duration }
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
      ref: {
        asset_id: item.asset_id,
        sha256: item.sha256,
        url: item.url,
        fallback_url: item.url,
        fallback_path: item.fallback_path
      },
      start: cursor,
      duration,
      in: 0,
      track: 1,
      origin: item.origin || "unknown",
      creation_time: item.creation_time || "",
      timeline: item.timeline || { anchor_time: anchorTimeForItem(item) || null, anchor_source: "unknown", confidence: 0 },
      facts: item.facts || { duration_seconds: duration }
    };
    cursor += duration;
    return clip;
  });
}

export function summarizeAssembledClips(clips) {
  const safe = Array.isArray(clips) ? clips : [];
  const missingAnchor = safe.filter((clip) => !clip?.timeline?.anchor_time && !clip?.creation_time).length;
  const missingDuration = safe.filter((clip) => !(Number(clip?.duration) > 0)).length;
  const byOrigin = new Map();
  safe.forEach((clip) => {
    const origin = clip?.origin || "unknown";
    if (!byOrigin.has(origin)) {
      byOrigin.set(origin, clip?.track ?? 0);
    }
  });
  const trackMap = Array.from(byOrigin.entries()).map(([origin, track]) => ({ origin, track }));
  return {
    total: safe.length,
    missingAnchor,
    missingDuration,
    trackMap
  };
}

export function clipsToImportNodes(clips) {
  if (!Array.isArray(clips) || !clips.length) return [];
  return [...clips]
    .sort((a, b) => a.start - b.start || a.track - b.track)
    .map((clip, index) => {
      const ref = clip?.ref || {};
      const line = ref.asset_id && (ref.fallback_url || ref.url)
        ? `${ref.asset_id}|${ref.fallback_url || ref.url}`
        : (ref.asset_id || ref.url || ref.fallback_path || "");
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
