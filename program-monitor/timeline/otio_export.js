/**
 * OTIO exporter for Program Monitor RenderPlan artifacts.
 *
 * Usage:
 *   const { exportToOtio } = require('./program-monitor/timeline/otio_export');
 *   const output = exportToOtio(renderPlan, {
 *     outputPath: '/tmp/demo.otio',
 *     name: 'Demo Timeline'
 *   });
 *
 * Example CLI-style call:
 *   node -e "const fs=require('node:fs'); const { exportToOtio }=require('./program-monitor/timeline/otio_export'); const plan=JSON.parse(fs.readFileSync('render-plan.json','utf8')); console.log(exportToOtio(plan,{outputPath:'./timeline.otio',name:'Session'}));"
 */

const fs = require('node:fs');
const path = require('node:path');

const FALLBACK_RATE = 30;

function asPositiveNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function asRate(renderPlan) {
  const fps = asPositiveNumber(renderPlan && renderPlan.fps, Number.NaN);
  return Number.isFinite(fps) ? fps : FALLBACK_RATE;
}

function resolveNodeDuration(node) {
  return asPositiveNumber(
    node && (
      node.duration
      ?? node.duration_seconds
      ?? node.resolved_duration_sec
      ?? node.dur_sec
      ?? node.durationOverride
      ?? node.duration_override_sec
    ),
    0
  );
}

function safeNodeId(node, index) {
  if (node && node.id) {
    return String(node.id);
  }
  return `node-${index + 1}`;
}

function extractNodeLayers(node) {
  if (!node || typeof node !== 'object') {
    return { base: null, overlays: [] };
  }

  const roleLayers = Array.isArray(node.layers)
    ? node.layers.filter((layer) => layer && typeof layer === 'object')
    : [];

  const baseFromLayers = roleLayers.find((layer) => layer.role === 'base') || null;
  const overlaysFromLayers = roleLayers.filter((layer) => layer.role === 'overlay');

  const baseFallback = node.base && typeof node.base === 'object'
    ? { ...node.base, role: 'base' }
    : null;

  return {
    base: baseFromLayers || baseFallback,
    overlays: overlaysFromLayers
  };
}

function resolveOriginalUrl(layer) {
  const metadata = layer && typeof layer.metadata === 'object' ? layer.metadata : {};
  return metadata.originalUrl || metadata.original_url || layer.originalUrl || layer.original_url || layer.url || '';
}

function resolveBakedPath(layer) {
  const metadata = layer && typeof layer.metadata === 'object' ? layer.metadata : {};
  return metadata.bakedPlatePath
    || metadata.baked_plate_path
    || metadata.bakedPath
    || metadata.baked_path
    || metadata.renderedPath
    || metadata.rendered_path
    || metadata.platePath
    || metadata.plate_path
    || '';
}

function resolveTargetUrl(layer) {
  const baked = resolveBakedPath(layer);
  if (baked) {
    return String(baked);
  }
  const originalUrl = resolveOriginalUrl(layer);
  return originalUrl ? String(originalUrl) : '';
}

function rationalTime(value, rate) {
  return {
    OTIO_SCHEMA: 'RationalTime.1',
    value,
    rate
  };
}

function timeRange(durationSeconds, rate) {
  return {
    OTIO_SCHEMA: 'TimeRange.1',
    start_time: rationalTime(0, rate),
    duration: rationalTime(durationSeconds * rate, rate)
  };
}

function buildGap(durationSeconds, rate) {
  return {
    OTIO_SCHEMA: 'Gap.1',
    name: 'Gap',
    source_range: timeRange(durationSeconds, rate),
    effects: [],
    markers: [],
    metadata: {}
  };
}

function buildClip({ name, durationSeconds, rate, layer = {}, nodeId, nodeIndex, role, trackIndex }) {
  const originalUrl = resolveOriginalUrl(layer);
  const targetUrl = resolveTargetUrl(layer);

  return {
    OTIO_SCHEMA: 'Clip.1',
    name,
    media_reference: {
      OTIO_SCHEMA: 'ExternalReference.1',
      target_url: targetUrl,
      available_range: null,
      metadata: {
        originalUrl,
        preferred_source: targetUrl
      }
    },
    source_range: timeRange(durationSeconds, rate),
    effects: [],
    markers: [],
    metadata: {
      role,
      nodeId,
      nodeIndex,
      trackIndex,
      originalUrl
    }
  };
}

function buildOtioTimeline(renderPlan, { name } = {}) {
  if (!renderPlan || typeof renderPlan !== 'object') {
    throw new Error('invalid_render_plan');
  }
  const nodes = Array.isArray(renderPlan.nodes) ? renderPlan.nodes : [];
  const rate = asRate(renderPlan);

  const compiledNodes = nodes.map((node, index) => {
    const duration = resolveNodeDuration(node);
    const layers = extractNodeLayers(node);
    return {
      node,
      nodeIndex: index,
      nodeId: safeNodeId(node, index),
      duration,
      base: layers.base,
      overlays: layers.overlays
    };
  });

  const overlayTrackCount = compiledNodes.reduce((maxCount, item) => {
    const count = Array.isArray(item.overlays) ? item.overlays.length : 0;
    return Math.max(maxCount, count);
  }, 0);

  const baseChildren = compiledNodes.map((item) => {
    if (!item.base || !resolveTargetUrl(item.base)) {
      return buildGap(item.duration, rate);
    }
    return buildClip({
      name: `Base ${item.nodeId}`,
      durationSeconds: item.duration,
      rate,
      layer: item.base,
      nodeId: item.nodeId,
      nodeIndex: item.nodeIndex,
      role: 'base',
      trackIndex: 0
    });
  });

  const tracks = [
    {
      OTIO_SCHEMA: 'Track.1',
      name: 'Track 0 - Base',
      kind: 'Video',
      children: baseChildren,
      effects: [],
      markers: [],
      metadata: { role: 'base', trackIndex: 0 }
    }
  ];

  for (let overlayTrackIndex = 0; overlayTrackIndex < overlayTrackCount; overlayTrackIndex += 1) {
    const children = compiledNodes.map((item) => {
      const layer = item.overlays[overlayTrackIndex] || null;
      if (!layer || !resolveTargetUrl(layer)) {
        return buildGap(item.duration, rate);
      }
      return buildClip({
        name: `Overlay ${overlayTrackIndex + 1} ${item.nodeId}`,
        durationSeconds: item.duration,
        rate,
        layer,
        nodeId: item.nodeId,
        nodeIndex: item.nodeIndex,
        role: 'overlay',
        trackIndex: overlayTrackIndex + 1
      });
    });

    tracks.push({
      OTIO_SCHEMA: 'Track.1',
      name: `Track ${overlayTrackIndex + 1} - Overlay ${overlayTrackIndex + 1}`,
      kind: 'Video',
      children,
      effects: [],
      markers: [],
      metadata: { role: 'overlay', trackIndex: overlayTrackIndex + 1 }
    });
  }

  return {
    OTIO_SCHEMA: 'Timeline.1',
    name: name || renderPlan.name || renderPlan.id || 'RenderPlan Timeline',
    global_start_time: rationalTime(0, rate),
    tracks: {
      OTIO_SCHEMA: 'Stack.1',
      name: 'tracks',
      children: tracks,
      effects: [],
      markers: [],
      metadata: {}
    },
    metadata: {
      source: 'program-monitor.timeline.otio_export',
      renderPlanVersion: renderPlan.version || null,
      renderPlanId: renderPlan.id || null
    }
  };
}

function exportToOtio(renderPlan, { outputPath, name } = {}) {
  if (!outputPath || typeof outputPath !== 'string') {
    throw new Error('invalid_output_path');
  }
  const timeline = buildOtioTimeline(renderPlan, { name });
  const resolvedOutputPath = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolvedOutputPath), { recursive: true });
  fs.writeFileSync(resolvedOutputPath, JSON.stringify(timeline, null, 2));
  return resolvedOutputPath;
}

module.exports = {
  buildOtioTimeline,
  exportToOtio
};
