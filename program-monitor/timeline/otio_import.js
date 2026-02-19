/**
 * OTIO importer for Program Monitor timelines.
 * Usage (browser): import { importFromOtio } from "./timeline/otio_import.js";
 * Usage (node tests): import { importFromOtio } from "./otio_import.js";
 */

function asNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function rateValue(time) {
  const rate = asNumber(time && time.rate, 30);
  const value = asNumber(time && time.value, 0);
  return { rate: rate > 0 ? rate : 30, value };
}

function secondsFromRational(time) {
  const { rate, value } = rateValue(time);
  return value / rate;
}

function parseClipRef(clip) {
  const metadata = clip && clip.metadata && typeof clip.metadata === 'object' ? clip.metadata : {};
  const registry = metadata['cdaprod.registry'] && typeof metadata['cdaprod.registry'] === 'object'
    ? metadata['cdaprod.registry']
    : null;
  const targetUrl = clip && clip.media_reference ? String(clip.media_reference.target_url || '').trim() : '';
  const assetId = registry && typeof registry.asset_id === 'string' ? String(registry.asset_id).trim() : '';

  if (assetId) {
    return {
      asset_id: assetId,
      url: targetUrl || registry.fallback_relative_path || '',
      registry
    };
  }

  return { asset_id: '', url: targetUrl, registry: null };
}

function classifyTrackKind(track, trackIndex) {
  const metadata = track && track.metadata && typeof track.metadata === 'object' ? track.metadata : {};
  const role = String(metadata.role || '').toLowerCase();
  if (role === 'base') return 'video';
  if (role === 'overlay') return 'overlay_html';
  if (role === 'ambient') return 'audio';
  return trackIndex <= 0 ? 'video' : 'overlay_html';
}

function toNodeLine(ref) {
  if (ref.asset_id && ref.url) {
    return `${ref.asset_id}|${ref.url}`;
  }
  if (ref.asset_id) {
    return ref.asset_id;
  }
  return ref.url || '';
}

export function compileLegacyNodesFromClips(clips) {
  const grouped = new Map();
  (Array.isArray(clips) ? clips : []).forEach((clip) => {
    const key = `${clip.start.toFixed(3)}:${clip.duration.toFixed(3)}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        start: clip.start,
        duration: clip.duration,
        base: '',
        overlays: [],
        ambient: []
      });
    }
    const row = grouped.get(key);
    const line = toNodeLine(clip.ref);
    if (!line) return;
    if (clip.kind === 'audio') {
      row.ambient.push(line);
    } else if (clip.kind === 'video' && !row.base) {
      row.base = line;
    } else {
      row.overlays.push(line);
    }
  });

  return Array.from(grouped.values())
    .sort((a, b) => a.start - b.start)
    .map((row, index) => {
      const lines = [row.base, ...row.overlays, ...row.ambient].filter(Boolean);
      return {
        id: `node-${index + 1}`,
        text: lines.join('\n'),
        durationOverride: row.duration > 0 ? String(row.duration) : ''
      };
    });
}

export function flattenOtioClips(otio) {
  const tracks = otio && otio.tracks && Array.isArray(otio.tracks.children) ? otio.tracks.children : [];
  const clips = [];

  tracks.forEach((track, trackIndex) => {
    const kind = classifyTrackKind(track, trackIndex);
    let cursorSeconds = 0;
    const children = Array.isArray(track.children) ? track.children : [];
    children.forEach((item) => {
      const schema = String(item && item.OTIO_SCHEMA || '');
      if (!schema.startsWith('Clip.')) {
        const dur = secondsFromRational(item && item.source_range && item.source_range.duration);
        cursorSeconds += Math.max(0, dur);
        return;
      }

      const sourceRange = item.source_range || {};
      const duration = Math.max(0, secondsFromRational(sourceRange.duration));
      const trimIn = Math.max(0, secondsFromRational(sourceRange.start_time));
      const ref = parseClipRef(item);

      clips.push({
        id: String(item.name || `clip-${clips.length + 1}`),
        kind,
        ref: { asset_id: ref.asset_id || '', url: ref.url || '' },
        start: cursorSeconds,
        duration,
        in: trimIn,
        track: trackIndex,
        metadata: ref.registry ? { 'cdaprod.registry': ref.registry } : {}
      });
      cursorSeconds += duration;
    });
  });

  return clips;
}

export function importFromOtio(otioPayload) {
  if (!otioPayload || typeof otioPayload !== 'object' || !String(otioPayload.OTIO_SCHEMA || '').startsWith('Timeline.')) {
    throw new Error('invalid_otio_timeline');
  }
  const clips = flattenOtioClips(otioPayload);
  const nodes = compileLegacyNodesFromClips(clips);
  if (!nodes.length) {
    throw new Error('otio_contains_no_clips');
  }

  return {
    version: 1,
    nodes,
    clips,
    activeIndex: 0
  };
}
