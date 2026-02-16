/**
 * Build and write a render manifest artifact from a compiled RenderPlan payload.
 *
 * Usage:
 *   const { write_manifest } = require('./timeline/manifest');
 *   const manifestPath = write_manifest(plan, '/renders/job-123', { resolvedAssets, cacheKeys, timing });
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function hashObject(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value || {})).digest('hex');
}

function writeJsonAtomic(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  fs.renameSync(tmpPath, filePath);
}


function resolveNodeDurationSeconds(node) {
  const candidate = Number(
    node && (
      node.duration
      ?? node.duration_seconds
      ?? node.resolved_duration_sec
      ?? node.dur_sec
    )
  );
  if (Number.isFinite(candidate) && candidate > 0) {
    return candidate;
  }
  const override = Number(node && (node.durationOverride ?? node.duration_override_sec));
  if (Number.isFinite(override) && override > 0) {
    return override;
  }
  return Number.NaN;
}

function buildPlanTimingMetadata(plan) {
  const safePlan = plan && typeof plan === 'object' ? plan : {};
  const nodes = Array.isArray(safePlan.nodes) ? safePlan.nodes : [];
  if (!nodes.length) {
    return {
      ready: false,
      reason: 'missing_nodes',
      segments: [],
      total_duration_sec: Number.NaN
    };
  }

  const segments = [];
  let acc = 0;
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    const duration = resolveNodeDurationSeconds(node);
    if (!Number.isFinite(duration) || duration <= 0) {
      return {
        ready: false,
        reason: 'unknown_node_duration',
        segments: [],
        total_duration_sec: Number.NaN
      };
    }
    const startSec = acc;
    const endSec = startSec + duration;
    segments.push({
      node_id: node && node.id ? node.id : `node-${index + 1}`,
      index,
      start_sec: startSec,
      dur_sec: duration,
      end_sec: endSec
    });
    acc = endSec;
  }

  return {
    ready: true,
    reason: null,
    segments,
    total_duration_sec: acc
  };
}

function normalizeTimingMetadata({ timing = null, plan = null } = {}) {
  const timingFromPlan = plan && typeof plan === 'object' ? plan.timing : null;
  const source = timing && typeof timing === 'object' ? timing : timingFromPlan;
  const planTiming = buildPlanTimingMetadata(plan);
  return {
    mode: source && source.mode ? source.mode : null,
    degraded: source && Object.prototype.hasOwnProperty.call(source, 'degraded') ? Boolean(source.degraded) : null,
    fps: source && Number.isFinite(source.fps) ? source.fps : null,
    frame_count: source && Number.isFinite(source.frame_count) ? source.frame_count : null,
    duration_seconds: source && Number.isFinite(source.duration_seconds)
      ? source.duration_seconds
      : (planTiming.ready ? planTiming.total_duration_sec : null),
    duration_ms: source && Number.isFinite(source.duration_ms) ? source.duration_ms : null,
    start_time_seconds: source && Number.isFinite(source.start_time_seconds) ? source.start_time_seconds : 0,
    end_time_seconds: source && Number.isFinite(source.end_time_seconds)
      ? source.end_time_seconds
      : (planTiming.ready ? planTiming.total_duration_sec : null),
    ready: planTiming.ready,
    reason: planTiming.reason,
    total_duration_sec: planTiming.total_duration_sec,
    segments: planTiming.segments
  };
}

/**
 * Write render manifest.
 *
 * Scope safety: this function only reads the provided payload objects (`plan` and `opts`).
 */
function write_manifest(plan, out_dir, opts = {}) {
  if (!plan || typeof plan !== 'object') {
    throw new Error('invalid_render_plan');
  }
  if (!out_dir || typeof out_dir !== 'string') {
    throw new Error('invalid_manifest_out_dir');
  }

  const nowIso = new Date().toISOString();
  const resolvedAssets = Array.isArray(opts.resolvedAssets)
    ? opts.resolvedAssets
    : Array.isArray(plan.resolvedAssets)
      ? plan.resolvedAssets
      : [];
  const cacheKeys = opts.cacheKeys && typeof opts.cacheKeys === 'object'
    ? opts.cacheKeys
    : plan.cacheKeys && typeof plan.cacheKeys === 'object'
      ? plan.cacheKeys
      : {};

  const manifest = {
    version: 1,
    created_at: nowIso,
    updated_at: nowIso,
    plan_hash: hashObject(plan),
    render_plan: plan,
    resolved_assets: resolvedAssets,
    cache_keys: cacheKeys,
    timestamps: {
      created_at: nowIso,
      generated_at_ms: Date.now()
    },
    timing: normalizeTimingMetadata({ timing: opts.timing, plan })
  };

  const manifestPath = path.join(out_dir, 'manifest.json');
  writeJsonAtomic(manifestPath, manifest);
  return manifestPath;
}

module.exports = {
  write_manifest,
  normalizeTimingMetadata,
  buildPlanTimingMetadata,
  hashObject
};
