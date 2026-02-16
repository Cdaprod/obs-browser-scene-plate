/**
 * Render API server to trigger Playwright + ffmpeg renders.
 *
 * Usage:
 *   node /app/server.js
 *
 * Example:
 *   curl -X POST http://localhost:8791/api/render \
 *     -H "Content-Type: application/json" \
 *     -d '{"url":"http://nginx/plate-default.html","name":"plate","seconds":4,"fps":60,"width":1080,"height":1920}'
 *
 *   curl http://localhost:8791/api/render/<job_id>
 *
 *   curl http://localhost:8791/api/renders?limit=8
 */
const http = require('http');
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const url = require('url');

const {
  normalizeProjectName,
  safeReadJson,
  safeWriteJsonAtomic
} = require('./render-utils');
const { write_manifest, buildPlanTimingMetadata } = require('./timeline/manifest');
const { render_html_plate } = require('./render/html_plate');

const PORT = Number(process.env.PORT || 8791);
const RENDERS_DIR = process.env.RENDERS_DIR || '/renders';
const DELIVER_EXPORTS = process.env.DELIVER_EXPORTS !== '0';
const DELIVERY_SUBDIR = process.env.DELIVERY_SUBDIR || '_exports';
const RENDERS_EXPECT_MARKER = process.env.RENDERS_EXPECT_MARKER || '.renders_mount_ok';
const RENDERS_HOST_PATH_HINT = process.env.RENDERS_HOST_PATH || '';
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN || '';
const JOBS_DIR = path.join(RENDERS_DIR, '.jobs');
const MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_RENDER_ORIGIN = process.env.RENDER_ORIGIN || 'http://obs-plate';
const PROGRAM_MONITOR_DIR = path.join(RENDERS_DIR, 'program-monitor');
const PROGRAM_MONITOR_TMP_DIR = path.join(PROGRAM_MONITOR_DIR, 'tmp');
const PROGRAM_MONITOR_NODE_DIR = path.join(PROGRAM_MONITOR_DIR, 'nodes');
const PROGRAM_MONITOR_TIMELINE_DIR = path.join(PROGRAM_MONITOR_DIR, 'timelines');
const PROGRAM_MONITOR_TMP_TTL_MS = Number(process.env.PROGRAM_MONITOR_TMP_TTL_MS || 30 * 60 * 1000);
const PROGRAM_MONITOR_CACHE_TTL_MS = Number(process.env.PROGRAM_MONITOR_CACHE_TTL_MS || 6 * 60 * 60 * 1000);
const PROGRAM_MONITOR_CACHE_MAX_FILES = Number(process.env.PROGRAM_MONITOR_CACHE_MAX_FILES || 120);
const STAGE_TTL_SECONDS = Number(process.env.STAGE_TTL_SECONDS || 60 * 60 * 6);
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || path.join(RENDERS_DIR, 'workspace');
const PROJECTS_DIR = path.join(WORKSPACE_DIR, 'projects');
const STAGE_DIR = path.join(WORKSPACE_DIR, 'stage');
const JOB_RETENTION_MS = Number(process.env.JOB_RETENTION_MS || 60 * 60 * 1000);
const JOB_MEMORY_LIMIT = Number(process.env.JOB_MEMORY_LIMIT || 400);

const PROGRAM_MONITOR_AUDIO_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.aac', '.ogg'];
const PROGRAM_MONITOR_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
const PROGRAM_MONITOR_VIDEO_EXTENSIONS = ['.mp4', '.mov', '.webm', '.mkv'];
const EXPORT_RANGE_EXTENSIONS = new Set(['.mov', '.mp4', '.m4v']);

function getExportContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.json') {
    return 'application/json';
  }
  if (ext === '.log') {
    return 'text/plain';
  }
  if (ext === '.mp4' || ext === '.m4v') {
    return 'video/mp4';
  }
  if (ext === '.webm') {
    return 'video/webm';
  }
  if (ext === '.mov') {
    return 'video/quicktime';
  }
  return 'application/octet-stream';
}

function parseRangeHeader(rangeHeader, size) {
  if (!rangeHeader) {
    return null;
  }
  const match = String(rangeHeader).match(/bytes=(\d*)-(\d*)/);
  if (!match) {
    return null;
  }
  let start = match[1] ? Number.parseInt(match[1], 10) : null;
  let end = match[2] ? Number.parseInt(match[2], 10) : null;
  if (start === null && end === null) {
    return null;
  }
  if (start === null && end !== null) {
    start = Math.max(size - end, 0);
    end = size - 1;
  } else {
    if (end === null || end >= size) {
      end = size - 1;
    }
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
    return { invalid: true };
  }
  return { start, end };
}

function buildRangeResponse({ rangeHeader, size, contentType }) {
  if (!rangeHeader) {
    return {
      statusCode: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': size,
        'Accept-Ranges': 'bytes'
      }
    };
  }
  const parsed = parseRangeHeader(rangeHeader, size);
  if (!parsed) {
    return {
      statusCode: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': size,
        'Accept-Ranges': 'bytes'
      }
    };
  }
  if (parsed.invalid) {
    return {
      statusCode: 416,
      headers: {
        'Content-Range': `bytes */${size}`,
        'Accept-Ranges': 'bytes'
      }
    };
  }
  const chunkSize = parsed.end - parsed.start + 1;
  return {
    statusCode: 206,
    headers: {
      'Content-Type': contentType,
      'Content-Length': chunkSize,
      'Content-Range': `bytes ${parsed.start}-${parsed.end}/${size}`,
      'Accept-Ranges': 'bytes'
    },
    start: parsed.start,
    end: parsed.end
  };
}

function resolveExportFilePath({ projectId, jobId, filename, baseDir = PROJECTS_DIR } = {}) {
  if (!projectId || !jobId || !filename) {
    return null;
  }
  const safeProject = safeName(projectId);
  const safeJob = safeName(jobId);
  const exportRoot = path.join(baseDir, safeProject, 'exports', safeJob);
  const normalized = path.normalize(filename);
  if (normalized.split(path.sep).includes('..')) {
    return null;
  }
  const resolved = path.resolve(exportRoot, normalized);
  if (resolved !== exportRoot && !resolved.startsWith(`${exportRoot}${path.sep}`)) {
    return null;
  }
  return resolved;
}

function resolveDeliveryDir({ projectId, jobId, rendersDir = RENDERS_DIR, subdir = DELIVERY_SUBDIR } = {}) {
  if (!projectId || !jobId) {
    return null;
  }
  return path.join(
    rendersDir,
    subdir,
    safeName(projectId),
    'exports',
    safeName(jobId)
  );
}

function buildDebugFramePath({ projectId, jobId, rendersDir = RENDERS_DIR, subdir = DELIVERY_SUBDIR } = {}) {
  const deliveryDir = resolveDeliveryDir({ projectId, jobId, rendersDir, subdir });
  if (!deliveryDir) {
    return null;
  }
  return path.join(deliveryDir, 'debug_first_frame.png');
}

function writeFileAtomic(filePath, contents) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, contents);
  fs.renameSync(tempPath, filePath);
}

function copyFileAtomic(sourcePath, targetPath) {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  const tempPath = `${targetPath}.tmp`;
  fs.copyFileSync(sourcePath, tempPath);
  fs.renameSync(tempPath, targetPath);
}

function ensureRendersDirState({ rendersDir = RENDERS_DIR } = {}) {
  const state = {
    rendersDir,
    exists: false,
    writable: false,
    markerPresent: false,
    realpath: null,
    error: null
  };
  try {
    fs.mkdirSync(rendersDir, { recursive: true });
    state.exists = true;
    const markerPath = path.join(rendersDir, RENDERS_EXPECT_MARKER);
    const markerPayload = `${new Date().toISOString()} ${os.hostname()}\n`;
    writeFileAtomic(markerPath, markerPayload);
    state.markerPresent = fs.existsSync(markerPath);
    state.writable = true;
    state.realpath = fs.realpathSync(rendersDir);
  } catch (error) {
    state.error = error.message || String(error);
    state.writable = false;
  }
  return state;
}

function getRendersDirDiagnostics({ rendersDir = RENDERS_DIR } = {}) {
  const diagnostics = ensureRendersDirState({ rendersDir });
  let stat = null;
  try {
    stat = fs.statSync(rendersDir);
  } catch (_) {
    stat = null;
  }
  let listing = [];
  try {
    listing = fs.readdirSync(rendersDir).slice(0, 50);
  } catch (_) {
    listing = [];
  }
  return {
    ...diagnostics,
    stat: stat
      ? {
        isDirectory: stat.isDirectory(),
        mode: stat.mode,
        size: stat.size,
        mtime: stat.mtime.toISOString()
      }
      : null,
    sample_listing: listing
  };
}

function buildDeliveryFiles({ deliveryDir, filename, previewFilename, debugFrameFilename }) {
  if (!deliveryDir) {
    return null;
  }
  return {
    mov: path.join(deliveryDir, filename),
    log: path.join(deliveryDir, 'render.log'),
    manifest: path.join(deliveryDir, 'manifest.json'),
    preview: previewFilename ? path.join(deliveryDir, previewFilename) : null,
    debug_frame: debugFrameFilename ? path.join(deliveryDir, debugFrameFilename) : null
  };
}

async function deliverExportArtifacts({
  projectId,
  jobId,
  jobDir,
  filename = 'render.mov',
  previewFilename = null,
  debugFrameFilename = null,
  deliverEnabled = DELIVER_EXPORTS,
  rendersDir = RENDERS_DIR,
  subdir = DELIVERY_SUBDIR,
  hostHint = RENDERS_HOST_PATH_HINT
} = {}) {
  const deliveryDir = resolveDeliveryDir({ projectId, jobId, rendersDir, subdir });
  const deliveryFiles = buildDeliveryFiles({ deliveryDir, filename, previewFilename, debugFrameFilename });
  if (!deliverEnabled) {
    return {
      delivered: false,
      error: 'delivery_disabled',
      deliveredDir: deliveryDir,
      deliveredFiles: deliveryFiles,
      hostHint
    };
  }
  if (!jobDir || !deliveryDir || !deliveryFiles) {
    return {
      delivered: false,
      error: 'delivery_missing_paths',
      deliveredDir: deliveryDir,
      deliveredFiles: deliveryFiles,
      hostHint
    };
  }
  const renderPath = path.join(jobDir, filename);
  const logPath = exportLogPath(jobDir);
  const manifestPath = exportManifestPath(jobDir);
  const previewPath = previewFilename ? path.join(jobDir, previewFilename) : null;
  const debugFramePath = debugFrameFilename ? path.join(jobDir, debugFrameFilename) : null;
  try {
    ensureRendersDirState({ rendersDir });
    copyFileAtomic(renderPath, deliveryFiles.mov);
    if (fs.existsSync(logPath)) {
      copyFileAtomic(logPath, deliveryFiles.log);
    }
    if (previewPath && deliveryFiles.preview && fs.existsSync(previewPath)) {
      copyFileAtomic(previewPath, deliveryFiles.preview);
    }
    if (deliveryFiles.debug_frame) {
      if (debugFramePath && fs.existsSync(debugFramePath)) {
        copyFileAtomic(debugFramePath, deliveryFiles.debug_frame);
      }
    }
    if (fs.existsSync(manifestPath)) {
      copyFileAtomic(manifestPath, deliveryFiles.manifest);
    }
    return {
      delivered: true,
      error: null,
      deliveredDir: deliveryDir,
      deliveredFiles: deliveryFiles,
      hostHint
    };
  } catch (error) {
    return {
      delivered: false,
      error: error.message || String(error),
      deliveredDir: deliveryDir,
      deliveredFiles: deliveryFiles,
      hostHint
    };
  }
}

function listDeliveredExports(projectId, { rendersDir = RENDERS_DIR, subdir = DELIVERY_SUBDIR } = {}) {
  const safeProject = safeName(projectId || '');
  const rootDir = path.join(rendersDir, subdir, safeProject, 'exports');
  if (!fs.existsSync(rootDir)) {
    return [];
  }
  return fs.readdirSync(rootDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const jobDir = path.join(rootDir, entry.name);
      const manifestPath = path.join(jobDir, 'manifest.json');
      const manifest = readJsonSafe(manifestPath, null);
      return {
        job_id: entry.name,
        delivered_dir: jobDir,
        manifest
      };
    });
}

function buildDeliveryStatus({ projectId, jobId, rendersDir = RENDERS_DIR, subdir = DELIVERY_SUBDIR } = {}) {
  const deliveryDir = resolveDeliveryDir({ projectId, jobId, rendersDir, subdir });
  if (!deliveryDir || !fs.existsSync(deliveryDir)) {
    return {
      delivered: false,
      delivered_dir: deliveryDir,
      files: {},
      host_hint: RENDERS_HOST_PATH_HINT
    };
  }
  const files = {};
  const fileList = ['render.mov', 'render.log', 'manifest.json', 'render_preview.mp4', 'debug_first_frame.png'];
  fileList.forEach((name) => {
    const filePath = path.join(deliveryDir, name);
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      files[name] = {
        path: filePath,
        size_bytes: stats.size,
        mtime: stats.mtime.toISOString()
      };
    }
  });
  return {
    delivered: Object.keys(files).length > 0,
    delivered_dir: deliveryDir,
    files,
    host_hint: RENDERS_HOST_PATH_HINT
  };
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(body);
}

function safeName(name) {
  return String(name || 'export').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120);
}

/**
 * Program Monitor export helpers.
 *
 * Usage (API):
 *   curl -X POST http://localhost:8791/api/program-monitor/export-node \
 *     -H "Content-Type: application/json" \
 *     -d '{"node":{"text":"http://nginx/plate-default.html"},"options":{"fps":60,"width":1080,"height":1920}}'
 */
function parseProgramMonitorText(text) {
  const lines = String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('//'));

  return {
    baseUrl: lines[0] || '',
    layers: lines.slice(1),
    lines
  };
}

function classifyProgramMonitorUrl(url) {
  const lower = String(url || '').toLowerCase();
  const pathname = extractPathname(lower);

  if (PROGRAM_MONITOR_AUDIO_EXTENSIONS.some((ext) => pathname.endsWith(ext))) {
    return 'audio';
  }
  if (PROGRAM_MONITOR_IMAGE_EXTENSIONS.some((ext) => pathname.endsWith(ext))) {
    return 'image';
  }
  if (pathname.endsWith('.html') || pathname.endsWith('.htm') || pathname.includes('/overlays/')) {
    return 'html';
  }
  if (PROGRAM_MONITOR_VIDEO_EXTENSIONS.some((ext) => pathname.endsWith(ext))) {
    return 'video';
  }
  return 'video';
}

function normalizeProgramMonitorUrl(value) {
  return normalizeRenderUrl(value, { renderOrigin: DEFAULT_RENDER_ORIGIN, publicOrigin: PUBLIC_ORIGIN });
}

function containsPublicOrigin(urlValue, publicOrigin = PUBLIC_ORIGIN) {
  if (!urlValue || !publicOrigin) {
    return false;
  }
  try {
    const publicUrl = new URL(publicOrigin);
    const parsed = new URL(urlValue);
    return parsed.origin === publicUrl.origin;
  } catch (error) {
    return false;
  }
}

function isForbiddenRenderOrigin(urlValue) {
  if (!urlValue) {
    return false;
  }
  try {
    const parsed = new URL(urlValue);
    if (parsed.hostname === '192.168.0.25' && parsed.port === '8789') {
      return true;
    }
    if (parsed.hostname === 'obs-plate' && parsed.port === '8789') {
      return true;
    }
    return false;
  } catch (error) {
    return false;
  }
}

function assertRenderOriginSafe({ urls = [], context = '' } = {}) {
  const unsafe = urls.filter((value) => containsPublicOrigin(value) || isForbiddenRenderOrigin(value));
  if (!unsafe.length) {
    return;
  }
  const message = `render origin rewrite failed for ${context || 'program-monitor'}: ${unsafe.join(', ')}`;
  throw new Error(message);
}

function extractPathname(value) {
  if (!value) {
    return '';
  }
  if (!value.includes('://')) {
    return value;
  }
  try {
    return new URL(value).pathname.toLowerCase();
  } catch (error) {
    return value;
  }
}

function buildProgramMonitorHash(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 12);
}

function buildProgramMonitorFilename({ prefix, hash, width, height, fps, seconds }) {
  const durationLabel = Number.isFinite(seconds) ? `${Math.round(seconds * 1000)}ms` : 'auto';
  return `${prefix}_${width}x${height}_${fps}fps_${durationLabel}_${hash}.mov`;
}

function assertHtmlDurationSeconds({ url, durationSeconds, context = '' } = {}) {
  if (classifyProgramMonitorUrl(url) !== 'html') {
    return;
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    const suffix = context ? `_${context}` : '';
    throw new Error(`missing_duration_seconds${suffix}`);
  }
}

function buildProgramMonitorTimelineHash(timeline, { fps, width, height }) {
  return buildProgramMonitorHash({
    nodes: (timeline.nodes || []).map((node) => ({
      text: node.text || '',
      durationSeconds: parseOptionalNumber(node.durationSeconds)
        ?? parseOptionalNumber(node.duration_seconds)
        ?? null
    })),
    fps,
    width,
    height
  });
}

function ensureStageDir(dir = STAGE_DIR) {
  fs.mkdirSync(dir, { recursive: true });
}

function createStageId() {
  if (crypto.randomUUID) {
    return crypto.randomUUID().slice(0, 12);
  }
  return crypto.randomBytes(8).toString('hex');
}

function stagePath(stageId, dir = STAGE_DIR) {
  const safeId = String(stageId || '').replace(/[^a-zA-Z0-9_-]+/g, '');
  return path.join(dir, `stage-${safeId}.json`);
}

function writeStage({ stageId, payload, expiresAt, dir = STAGE_DIR } = {}) {
  ensureStageDir(dir);
  const entry = {
    id: stageId,
    createdAt: new Date().toISOString(),
    expiresAt,
    payload
  };
  atomicWriteJson(stagePath(stageId, dir), entry);
  return entry;
}

function readStage({ stageId, dir = STAGE_DIR } = {}) {
  if (!stageId) {
    return null;
  }
  ensureStageDir(dir);
  const filePath = stagePath(stageId, dir);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    const expiresAt = parsed && parsed.expiresAt ? Date.parse(parsed.expiresAt) : null;
    if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
      fs.unlinkSync(filePath);
      return null;
    }
    return parsed;
  } catch (error) {
    console.warn('stage cache read failed', error);
    return null;
  }
}

function deleteStage({ stageId, dir = STAGE_DIR } = {}) {
  const filePath = stagePath(stageId, dir);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

function gcStages({ dir = STAGE_DIR, now = Date.now() } = {}) {
  try {
    if (!fs.existsSync(dir)) {
      return;
    }
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    entries.forEach((entry) => {
      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        return;
      }
      const filePath = path.join(dir, entry.name);
      try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        const expiresAt = parsed && parsed.expiresAt ? Date.parse(parsed.expiresAt) : null;
        if (Number.isFinite(expiresAt) && expiresAt <= now) {
          fs.unlinkSync(filePath);
        }
      } catch (error) {
        console.warn('stage cache cleanup failed', error);
      }
    });
  } catch (error) {
    console.warn('stage cache cleanup failed', error);
  }
}

function createStageEntry({ payload, dir = STAGE_DIR, ttlSeconds = STAGE_TTL_SECONDS } = {}) {
  if (!payload || !payload.timeline || !Array.isArray(payload.timeline.nodes)) {
    throw new Error('invalid_stage_payload');
  }
  gcStages({ dir });
  const stageId = createStageId();
  const ttl = Number.isFinite(ttlSeconds) ? ttlSeconds : STAGE_TTL_SECONDS;
  const expiresAt = new Date(Date.now() + Math.max(ttl, 1) * 1000).toISOString();
  return writeStage({ stageId, payload, expiresAt, dir });
}

function readStageEntry({ stageId, dir = STAGE_DIR } = {}) {
  gcStages({ dir });
  return readStage({ stageId, dir });
}

function ensureProjectDir(projectId, { baseDir = PROJECTS_DIR } = {}) {
  const safeId = safeName(projectId || '');
  const dir = path.join(baseDir, safeId);
  ensureDir(dir);
  return dir;
}

function readJsonSafe(filePath, fallback) {
  return safeReadJson(filePath, fallback);
}

function atomicWriteJson(filePath, data) {
  safeWriteJsonAtomic(filePath, data);
}

function projectIndexPath({ baseDir = PROJECTS_DIR } = {}) {
  return path.join(baseDir, '_index.json');
}

function projectStatePath(projectId, { baseDir = PROJECTS_DIR } = {}) {
  const dir = ensureProjectDir(projectId, { baseDir });
  return path.join(dir, 'project.json');
}

function readProjectIndex({ baseDir = PROJECTS_DIR } = {}) {
  const index = readJsonSafe(projectIndexPath({ baseDir }), { version: 1, projects: [] });
  const entries = Array.isArray(index?.projects) ? index.projects : [];
  return entries
    .filter((entry) => entry && entry.project_id && entry.name)
    .sort((a, b) => Date.parse(b.updated_at || 0) - Date.parse(a.updated_at || 0));
}

function writeProjectIndex(entries, { baseDir = PROJECTS_DIR } = {}) {
  atomicWriteJson(projectIndexPath({ baseDir }), {
    version: 1,
    projects: entries
  });
}

function upsertProjectIndexEntry(entry, { baseDir = PROJECTS_DIR } = {}) {
  const entries = readProjectIndex({ baseDir }).filter((item) => item.project_id !== entry.project_id);
  entries.push(entry);
  entries.sort((a, b) => Date.parse(b.updated_at || 0) - Date.parse(a.updated_at || 0));
  writeProjectIndex(entries, { baseDir });
  return entries;
}

function normalizeProjectTimeline(timeline) {
  const source = timeline && typeof timeline === 'object' ? timeline : {};
  const nodes = Array.isArray(source.nodes) ? source.nodes : [];
  return {
    version: Number.isFinite(source.version) ? source.version : 1,
    activeIndex: Number.isFinite(source.activeIndex) ? source.activeIndex : 0,
    nodes,
    nodesStructured: Array.isArray(source.nodesStructured) ? source.nodesStructured : []
  };
}

function normalizeProjectPayload(payload) {
  if (payload && payload.timeline && typeof payload.timeline === 'object') {
    return { timeline: normalizeProjectTimeline(payload.timeline) };
  }
  if (payload && Array.isArray(payload.nodes)) {
    return { timeline: normalizeProjectTimeline(payload) };
  }
  return { timeline: normalizeProjectTimeline({ version: 1, nodes: [], activeIndex: 0 }) };
}

function readProjectState(projectId, { baseDir = PROJECTS_DIR } = {}) {
  return readJsonSafe(projectStatePath(projectId, { baseDir }), null);
}

function buildProjectIdFromName(name) {
  const normalized = normalizeProjectName(name).toLowerCase();
  const slug = normalized
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug || crypto.randomUUID();
}

function saveProjectState({ projectId, name, payload, nowIso = new Date().toISOString(), baseDir = PROJECTS_DIR } = {}) {
  const normalizedName = normalizeProjectName(name);
  const existing = readProjectState(projectId, { baseDir });
  const next = {
    id: projectId,
    project_id: projectId,
    name: normalizedName,
    created_at: existing?.created_at || nowIso,
    updated_at: nowIso,
    payload: normalizeProjectPayload(payload)
  };
  atomicWriteJson(projectStatePath(projectId, { baseDir }), next);
  upsertProjectIndexEntry({
    project_id: projectId,
    name: normalizedName,
    created_at: next.created_at,
    updated_at: next.updated_at
  }, { baseDir });
  atomicWriteJson(projectTimelinePath(projectId, { baseDir }), next.payload.timeline);
  return next;
}

function resolveProjectByName(name, { baseDir = PROJECTS_DIR } = {}) {
  const normalizedName = normalizeProjectName(name);
  if (!normalizedName) {
    throw new Error('missing_project_name');
  }
  const lowered = normalizedName.toLowerCase();
  const existing = readProjectIndex({ baseDir }).find((entry) => String(entry.name || '').trim().toLowerCase() === lowered);
  if (existing) {
    const project = readProjectState(existing.project_id, { baseDir });
    if (project) {
      return project;
    }
    return saveProjectState({
      projectId: existing.project_id,
      name: existing.name,
      payload: { timeline: { version: 1, activeIndex: 0, nodes: [], nodesStructured: [] } },
      baseDir
    });
  }

  let projectId = buildProjectIdFromName(normalizedName);
  while (readProjectState(projectId, { baseDir })) {
    projectId = `${buildProjectIdFromName(normalizedName)}-${Math.random().toString(16).slice(2, 8)}`;
  }

  return saveProjectState({
    projectId,
    name: normalizedName,
    payload: { timeline: { version: 1, activeIndex: 0, nodes: [], nodesStructured: [] } },
    baseDir
  });
}

function deleteProjectState(projectId, { baseDir = PROJECTS_DIR } = {}) {
  const projectDir = path.join(baseDir, safeName(projectId || ''));
  if (fs.existsSync(projectDir)) {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
  const entries = readProjectIndex({ baseDir }).filter((entry) => entry.project_id !== projectId);
  writeProjectIndex(entries, { baseDir });
}

function projectTimelinePath(projectId, { baseDir = PROJECTS_DIR } = {}) {
  const dir = ensureProjectDir(projectId, { baseDir });
  return path.join(dir, 'timeline_draft.json');
}

function projectExportsDir(projectId, { baseDir = PROJECTS_DIR } = {}) {
  const dir = ensureProjectDir(projectId, { baseDir });
  return path.join(dir, 'exports');
}

function projectExportJobDir(projectId, jobId, { baseDir = PROJECTS_DIR } = {}) {
  const dir = projectExportsDir(projectId, { baseDir });
  const safeJobId = safeName(jobId || '');
  const jobDir = path.join(dir, safeJobId);
  fs.mkdirSync(jobDir, { recursive: true });
  return jobDir;
}

function exportManifestPath(jobDir) {
  return path.join(jobDir, 'manifest.json');
}

function exportLogPath(jobDir) {
  return path.join(jobDir, 'render.log');
}

function appendExportLog(jobDir, message) {
  try {
    fs.appendFileSync(exportLogPath(jobDir), `${new Date().toISOString()} ${message}\n`);
  } catch (error) {
    console.warn('export log write failed', error);
  }
}

function listProjectExports(projectId, { baseDir = PROJECTS_DIR } = {}) {
  const dir = projectExportsDir(projectId, { baseDir });
  if (!fs.existsSync(dir)) {
    return [];
  }
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const jobDir = path.join(dir, entry.name);
      const manifest = readJsonSafe(exportManifestPath(jobDir), null);
      const baseUrl = `/exports/${encodeURIComponent(safeName(projectId || ''))}/${encodeURIComponent(entry.name)}`;
      const manifestUrl = `${baseUrl}/manifest.json`;
      const logUrl = `${baseUrl}/render.log`;
      if (manifest && manifest.download_url) {
        return manifest;
      }
      const renderPath = path.join(jobDir, 'render.mov');
      if (!fs.existsSync(renderPath)) {
        return null;
      }
      const stats = fs.statSync(renderPath);
      return {
        job_id: entry.name,
        project_id: projectId,
        filename: 'render.mov',
        output_relpath: buildProjectExportRelpath(projectId, entry.name, 'render.mov'),
        output_name: `${safeName(projectId)}_${safeName(entry.name)}.mov`,
        created_at: stats.mtime.toISOString(),
        size_bytes: stats.size,
        download_url: `${baseUrl}/render.mov`,
        manifest_url: manifestUrl,
        log_url: logUrl
      };
    })
    .filter(Boolean)
    .sort((a, b) => Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0));
}

function getProjectTimeline(projectId) {
  const project = readProjectState(projectId);
  if (project?.payload?.timeline) {
    return normalizeProjectTimeline(project.payload.timeline);
  }
  return normalizeProjectTimeline(readJsonSafe(projectTimelinePath(projectId), {
    version: 1,
    nodes: [],
    activeIndex: 0,
    nodesStructured: []
  }));
}

function buildProgramMonitorHtml({ baseUrl, layers }) {
  const baseKind = classifyProgramMonitorUrl(baseUrl);
  const baseMarkup = baseKind === 'html'
    ? `<iframe id="base" src="${baseUrl}" frameborder="0" allow="autoplay" scrolling="no"></iframe>`
    : `<video id="base" src="${baseUrl}" playsinline muted></video>`;
  const overlayMarkup = layers
    .map((url, index) => {
      const kind = classifyProgramMonitorUrl(url);
      if (kind === 'audio') {
        return `<audio data-layer="audio-${index}" src="${url}" loop></audio>`;
      }
      if (kind === 'image') {
        return `<img data-layer="image-${index}" src="${url}" alt="" />`;
      }
      if (kind === 'html') {
        return `<iframe data-layer="html-${index}" src="${url}" frameborder="0" allow="autoplay" scrolling="no"></iframe>`;
      }
      return `<video data-layer="video-${index}" src="${url}" loop muted playsinline></video>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Program Monitor Export</title>
  <style>
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      background: transparent;
      overflow: hidden;
    }
    .stage {
      position: relative;
      width: 100%;
      height: 100%;
      background: transparent;
    }
    video, img, iframe {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: contain;
      border: 0;
    }
  </style>
</head>
<body>
  <div class="stage">
    ${baseMarkup}
    ${overlayMarkup}
  </div>
  <script>
    const base = document.getElementById('base');
    const overlays = Array.from(document.querySelectorAll('video[data-layer]'));
    const iframes = Array.from(document.querySelectorAll('iframe[data-layer]'));
    const audios = Array.from(document.querySelectorAll('audio[data-layer]'));

    function startPlayback() {
      if (base && base.tagName === 'VIDEO') {
        base.play().catch(() => {});
      }
      overlays.forEach((video) => video.play().catch(() => {}));
      audios.forEach((audio) => audio.play().catch(() => {}));
    }

    if (base && base.tagName === 'VIDEO') {
      base.addEventListener('loadedmetadata', () => {
        const duration = Number(base.duration);
        if (Number.isFinite(duration) && duration > 0) {
          window.__RENDER_SECONDS = duration;
          window.dispatchEvent(new CustomEvent('render:duration', { detail: { seconds: duration } }));
        }
        startPlayback();
      });
    }

    window.addEventListener('load', () => {
      window.__RENDER_READY = true;
      startPlayback();
    });
  </script>
</body>
</html>`;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function buildFilename({ name, width, height, fps, seconds, now = new Date() }) {
  const base = safeName(name || 'export');
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const durationLabel = Number.isFinite(seconds) ? `${Math.round(seconds * 1000)}ms` : 'auto';
  return `${base}_${width}x${height}_${fps}fps_${durationLabel}_${stamp}.mov`;
}

function parseOptionalNumber(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isLocalhostHost(hostname) {
  return ['localhost', '127.0.0.1', '0.0.0.0'].includes(hostname);
}

function rewriteOrigin(urlValue, { publicOrigin = PUBLIC_ORIGIN, renderOrigin = DEFAULT_RENDER_ORIGIN } = {}) {
  if (!urlValue || !publicOrigin) {
    try {
      const parsed = new URL(urlValue);
      if (parsed.hostname === '192.168.0.25' && parsed.port === '8789') {
        const relative = `${parsed.pathname}${parsed.search}${parsed.hash}`;
        return new URL(relative, renderOrigin).toString();
      }
    } catch (error) {
      return urlValue;
    }
    return urlValue;
  }
  try {
    const publicUrl = new URL(publicOrigin);
    const parsed = new URL(urlValue);
    if (parsed.origin === publicUrl.origin) {
      const relative = `${parsed.pathname}${parsed.search}${parsed.hash}`;
      return new URL(relative, renderOrigin).toString();
    }
    if (parsed.hostname === '192.168.0.25' && parsed.port === '8789') {
      const relative = `${parsed.pathname}${parsed.search}${parsed.hash}`;
      return new URL(relative, renderOrigin).toString();
    }
  } catch (error) {
    return urlValue;
  }
  return urlValue;
}

function normalizeRenderUrl(inputUrl, { renderOrigin = DEFAULT_RENDER_ORIGIN, publicOrigin = PUBLIC_ORIGIN } = {}) {
  if (!inputUrl) {
    return null;
  }

  const trimmed = String(inputUrl).trim();
  if (!trimmed) {
    return null;
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch (err) {
    if (trimmed.startsWith('/')) {
      return new URL(trimmed, renderOrigin).toString();
    }
    return null;
  }

  const rewritten = rewriteOrigin(parsed.toString(), { publicOrigin, renderOrigin });
  if (rewritten && rewritten !== parsed.toString()) {
    return rewritten;
  }

  if (isLocalhostHost(parsed.hostname)) {
    const relative = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return new URL(relative, renderOrigin).toString();
  }

  return parsed.toString();
}

function listRenderFiles({ dir = RENDERS_DIR, limit = 25 } = {}) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => name && !name.startsWith('.'))
      .filter((name) => name.toLowerCase().endsWith('.mov'))
      .map((name) => {
        const filePath = path.join(dir, name);
        const stats = fs.statSync(filePath);
        return {
          filename: name,
          size_bytes: stats.size,
          updated_at: stats.mtime.toISOString(),
          download_url: `/renders/${encodeURIComponent(name)}`,
          _mtimeMs: stats.mtimeMs
        };
      })
      .sort((a, b) => b._mtimeMs - a._mtimeMs)
      .slice(0, Number.isFinite(limit) && limit > 0 ? limit : 25)
      .map(({ _mtimeMs, ...entry }) => entry);
    return files;
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return [];
    }
    throw err;
  }
}

function ensureJobsDir() {
  fs.mkdirSync(JOBS_DIR, { recursive: true });
}

function jobPath(jobId) {
  return path.join(JOBS_DIR, `${jobId}.json`);
}

function writeJobFile(job) {
  ensureJobsDir();
  fs.writeFileSync(jobPath(job.id), JSON.stringify(job, null, 2));
}

function createJobId() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const jobs = new Map();

function updateJob(jobId, updates) {
  const current = jobs.get(jobId);
  if (!current) return null;
  const next = {
    ...current,
    ...updates,
    updatedAt: new Date().toISOString()
  };
  jobs.set(jobId, next);
  writeJobFile(next);
  return next;
}


function parseRenderTimingLine(line = '') {
  const match = String(line).match(/RENDER_TIMING:mode=([^\s]+)\s+degraded=(true|false)\s+animations=(\d+)\s+hooks=(\d+)/);
  if (!match) {
    return null;
  }
  return {
    timing_mode: match[1],
    timing_degraded: match[2] === 'true',
    timing_animations: Number(match[3]),
    timing_hooks: Number(match[4])
  };
}

/**
 * Invariant:
 * Export callbacks must never reference timing metadata from outer function locals.
 * All timing metadata must be passed explicitly via job/result payload objects.
 * Fallback resolution must use explicit objects, never identifier fallbacks.
 */

function normalizeRenderPlanPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  if (payload.plan && typeof payload.plan === 'object') {
    return payload.plan;
  }
  if (payload.render_plan && typeof payload.render_plan === 'object') {
    return payload.render_plan;
  }
  if (Array.isArray(payload.nodes)) {
    return payload;
  }
  return null;
}

function resolveTimingMetadata({ job = null, fallback = {} } = {}) {
  const fromJob = job || {};
  const fromFallback = fallback || {};
  return {
    timing_mode: fromJob.timingMode ?? fromFallback.timing_mode ?? null,
    timing_degraded: fromJob.timingDegraded ?? fromFallback.timing_degraded ?? null,
    timing_animations: fromJob.timingAnimations ?? fromFallback.timing_animations ?? null,
    timing_hooks: fromJob.timingHooks ?? fromFallback.timing_hooks ?? null
  };
}

function pruneJobs({
  now = Date.now(),
  retentionMs = JOB_RETENTION_MS,
  memoryLimit = JOB_MEMORY_LIMIT,
  jobsMap = jobs,
  jobsDir = JOBS_DIR
} = {}) {
  const completedStates = new Set(['ready', 'error']);
  const entries = Array.from(jobsMap.entries());
  const completed = [];

  for (const [jobId, job] of entries) {
    if (!job || !completedStates.has(job.state)) {
      continue;
    }
    const updatedAt = Date.parse(job.updatedAt || job.createdAt || '');
    completed.push({ jobId, updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0 });
    if (!Number.isFinite(updatedAt) || now - updatedAt < retentionMs) {
      continue;
    }
    jobsMap.delete(jobId);
    try {
      fs.rmSync(path.join(jobsDir, `${jobId}.json`), { force: true });
    } catch (_) {
      // ignore cleanup errors
    }
  }

  if (jobsMap.size <= memoryLimit) {
    return;
  }

  completed
    .sort((a, b) => a.updatedAt - b.updatedAt)
    .forEach(({ jobId }) => {
      if (jobsMap.size <= memoryLimit) {
        return;
      }
      jobsMap.delete(jobId);
      try {
        fs.rmSync(path.join(jobsDir, `${jobId}.json`), { force: true });
      } catch (_) {
        // ignore cleanup errors
      }
    });
}

function pruneRenderCacheDir({ dirPath, now = Date.now(), ttlMs = PROGRAM_MONITOR_CACHE_TTL_MS, maxFiles = PROGRAM_MONITOR_CACHE_MAX_FILES } = {}) {
  if (!dirPath || !fs.existsSync(dirPath)) {
    return;
  }
  const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const filePath = path.join(dirPath, entry.name);
      const stats = fs.statSync(filePath);
      return { filePath, mtimeMs: stats.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  entries.forEach((entry, index) => {
    const expired = now - entry.mtimeMs > ttlMs;
    const overLimit = index >= maxFiles;
    if (!expired && !overLimit) {
      return;
    }
    fs.rmSync(entry.filePath, { force: true });
  });
}

function gcProgramMonitorCache({
  now = Date.now(),
  tmpDir = PROGRAM_MONITOR_TMP_DIR,
  nodeDir = PROGRAM_MONITOR_NODE_DIR,
  timelineDir = PROGRAM_MONITOR_TIMELINE_DIR,
  tmpTtlMs = PROGRAM_MONITOR_TMP_TTL_MS,
  cacheTtlMs = PROGRAM_MONITOR_CACHE_TTL_MS,
  cacheMaxFiles = PROGRAM_MONITOR_CACHE_MAX_FILES
} = {}) {
  const tmpDirs = [tmpDir];
  tmpDirs.forEach((dirPath) => {
    if (!dirPath || !fs.existsSync(dirPath)) {
      return;
    }
    fs.readdirSync(dirPath, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .forEach((entry) => {
        const filePath = path.join(dirPath, entry.name);
        const stats = fs.statSync(filePath);
        if (now - stats.mtimeMs > tmpTtlMs) {
          fs.rmSync(filePath, { force: true });
        }
      });
  });

  pruneRenderCacheDir({ dirPath: nodeDir, now, ttlMs: cacheTtlMs, maxFiles: cacheMaxFiles });
  pruneRenderCacheDir({ dirPath: timelineDir, now, ttlMs: cacheTtlMs, maxFiles: cacheMaxFiles });
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > MAX_BODY_BYTES) {
        reject(new Error('payload_too_large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function spawnRenderJob({ jobId, url: targetUrl, outPath, fps, width, height, seconds, warmupMs, padSeconds }) {
  console.log(`render-api render_job=${jobId} url=${targetUrl} fps=${fps} duration=${seconds ?? 'auto'}`);
  const args = [
    '/app/render.js',
    `--url=${targetUrl}`,
    `--out=${outPath}`,
    `--fps=${fps}`,
    `--width=${width}`,
    `--height=${height}`
  ];

  if (seconds !== null && seconds !== undefined) {
    args.push(`--seconds=${seconds}`);
  }
  if (warmupMs !== null && warmupMs !== undefined) {
    args.push(`--warmupMs=${warmupMs}`);
  }
  if (padSeconds !== null && padSeconds !== undefined) {
    args.push(`--padSeconds=${padSeconds}`);
  }

  const child = spawn('node', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdoutBuffer = '';

  child.stdout.on('data', (chunk) => {
    const text = chunk.toString('utf8');
    process.stdout.write(text);
    stdoutBuffer += text;
    const lines = stdoutBuffer.split('\n');
    stdoutBuffer = lines.pop() || '';
    for (const line of lines) {
      if (line.includes('RENDER_STATE:rendering')) {
        updateJob(jobId, { state: 'rendering' });
      }
      if (line.includes('RENDER_STATE:encoding')) {
        updateJob(jobId, { state: 'encoding' });
      }
      const timing = parseRenderTimingLine(line);
      if (timing) {
        updateJob(jobId, {
          timingMode: timing.timing_mode,
          timingDegraded: timing.timing_degraded,
          timingAnimations: timing.timing_animations,
          timingHooks: timing.timing_hooks
        });
      }
    }
  });

  child.stderr.on('data', (chunk) => {
    process.stderr.write(chunk.toString('utf8'));
  });

  child.once('error', (err) => {
    console.error(err);
    updateJob(jobId, { state: 'error', error: 'render_spawn_failed' });
  });

  child.once('exit', (code) => {
    if (code === 0) {
      try {
        const stats = fs.statSync(outPath);
        if (stats.size > 0) {
          updateJob(jobId, {
            state: 'ready',
            downloadUrl: `/renders/${path.basename(outPath)}`
          });
          return;
        }
      } catch (err) {
        console.error(err);
      }
      updateJob(jobId, { state: 'error', error: 'render_empty_output' });
      return;
    }
    updateJob(jobId, { state: 'error', error: 'render_failed', exitCode: code });
  });
}

async function runTimelineJob({
  jobId,
  timeline,
  options,
  timelineHash,
  outputDir = PROGRAM_MONITOR_TIMELINE_DIR,
  filenamePrefix = 'program-monitor-timeline',
  downloadBase = '/renders/program-monitor/timelines',
  outputFilename = null,
  debugFramePath = null,
  logPath = null,
  onReady,
  onError
}) {
  let logStream = null;
  let writeLog = () => {};
  let listFile = null;
  try {
    const fps = options.fps;
    const width = options.width;
    const height = options.height;
    const warmupMs = options.warmupMs ?? null;
    const padSeconds = options.padSeconds ?? null;
    const defaultDurationSeconds = parseOptionalNumber(options.durationSeconds);
    const nodes = timeline.nodes || [];
    logStream = logPath ? fs.createWriteStream(logPath, { flags: 'a' }) : null;
    writeLog = (chunk) => {
      if (logStream) {
        logStream.write(chunk);
      }
    };
    let debugFrameUsed = false;
    let timelineTimingMode = null;
    let timelineTimingDegraded = false;
    let timelineTimingAnimations = 0;
    let timelineTimingHooks = 0;

    updateJob(jobId, { state: 'rendering', progress: 0 });

    const nodeOutputs = [];
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      const parsed = parseProgramMonitorText(node.text || '');
      if (!parsed.baseUrl) {
        throw new Error(`missing_base_url_${index}`);
      }

      const normalizedBase = normalizeProgramMonitorUrl(parsed.baseUrl);
      const normalizedLayers = parsed.layers
        .map((line) => normalizeProgramMonitorUrl(line))
        .filter(Boolean);

      if (!normalizedBase) {
        throw new Error(`invalid_base_url_${index}`);
      }
      assertRenderOriginSafe({
        urls: [normalizedBase, ...normalizedLayers],
        context: `timeline_node_${index}`
      });

      const nodeDurationSeconds = parseOptionalNumber(node.durationSeconds)
        ?? defaultDurationSeconds;
      const nodeHash = buildProgramMonitorHash({
        baseUrl: normalizedBase,
        layers: normalizedLayers,
        fps,
        width,
        height,
        durationSeconds: Number.isFinite(nodeDurationSeconds) ? nodeDurationSeconds : null
      });

      const html = buildProgramMonitorHtml({
        baseUrl: normalizedBase,
        layers: normalizedLayers
      });

      ensureDir(PROGRAM_MONITOR_TMP_DIR);
      ensureDir(PROGRAM_MONITOR_NODE_DIR);

      const htmlPath = path.join(PROGRAM_MONITOR_TMP_DIR, `node-${nodeHash}.html`);
      if (!fs.existsSync(htmlPath)) {
        fs.writeFileSync(htmlPath, html);
      }

      const nodeFilename = buildProgramMonitorFilename({
        prefix: 'program-monitor-node',
        hash: nodeHash,
        width,
        height,
        fps,
        seconds: Number.isFinite(nodeDurationSeconds) ? nodeDurationSeconds : null
      });
      const nodeOutPath = path.join(PROGRAM_MONITOR_NODE_DIR, nodeFilename);
      assertHtmlDurationSeconds({
        url: normalizedBase,
        durationSeconds: nodeDurationSeconds,
        context: String(index)
      });

      const shouldWriteDebugFrame = !debugFrameUsed
        && debugFramePath
        && classifyProgramMonitorUrl(normalizedBase) === 'html';
      const debugFrameExists = shouldWriteDebugFrame && fs.existsSync(debugFramePath);
      const shouldRenderNode = !fs.existsSync(nodeOutPath) || (shouldWriteDebugFrame && !debugFrameExists);

      if (shouldRenderNode) {
        await new Promise((resolve, reject) => {
          const args = [
            '/app/render.js',
            `--url=${DEFAULT_RENDER_ORIGIN}/renders/program-monitor/tmp/${path.basename(htmlPath)}`,
            `--out=${nodeOutPath}`,
            `--fps=${fps}`,
            `--width=${width}`,
            `--height=${height}`
          ];
          if (Number.isFinite(nodeDurationSeconds) && nodeDurationSeconds > 0) {
            args.push(`--seconds=${nodeDurationSeconds}`);
          }
          const env = { ...process.env };
          if (shouldWriteDebugFrame) {
            fs.mkdirSync(path.dirname(debugFramePath), { recursive: true });
            env.DEBUG_FRAME_OUT = debugFramePath;
          }
          const child = spawn('node', args, { stdio: ['ignore', 'pipe', 'pipe'], env });

          child.stdout.on('data', (chunk) => {
            const text = chunk.toString('utf8');
            process.stdout.write(text);
            writeLog(text);
            for (const line of text.split('\n')) {
              const timing = parseRenderTimingLine(line);
              if (!timing) {
                continue;
              }
              timelineTimingMode = timing.timing_mode;
              timelineTimingDegraded = timelineTimingDegraded || timing.timing_degraded;
              timelineTimingAnimations = Math.max(timelineTimingAnimations, timing.timing_animations);
              timelineTimingHooks = Math.max(timelineTimingHooks, timing.timing_hooks);
              updateJob(jobId, {
                timingMode: timelineTimingMode,
                timingDegraded: timelineTimingDegraded,
                timingAnimations: timelineTimingAnimations,
                timingHooks: timelineTimingHooks
              });
            }
          });

          child.stderr.on('data', (chunk) => {
            const text = chunk.toString('utf8');
            process.stderr.write(text);
            writeLog(text);
          });

          child.once('error', reject);
          child.once('exit', (code) => {
            if (code === 0) {
              if (shouldWriteDebugFrame) {
                debugFrameUsed = true;
              }
              resolve();
              return;
            }
            reject(new Error(`node_render_failed_${index}_${code}`));
          });
        });
      } else if (debugFrameExists) {
        debugFrameUsed = true;
      }

      nodeOutputs.push(nodeOutPath);
      const progress = Math.round(((index + 1) / nodes.length) * 90);
      updateJob(jobId, { progress });
    }

    updateJob(jobId, { state: 'encoding', progress: 95 });

    ensureDir(outputDir);
    listFile = path.join(PROGRAM_MONITOR_TMP_DIR, `timeline-${jobId}.txt`);
    fs.writeFileSync(
      listFile,
      nodeOutputs.map((filePath) => `file '${filePath.replace(/'/g, "'\\''")}'`).join('\n')
    );

    const resolvedTimelineHash = timelineHash || buildProgramMonitorTimelineHash(timeline, {
      fps,
      width,
      height
    });
    const timelineFilename = outputFilename || buildProgramMonitorFilename({
      prefix: filenamePrefix,
      hash: resolvedTimelineHash,
      width,
      height,
      fps,
      seconds: null
    });
    const timelineOutPath = path.join(outputDir, timelineFilename);

    if (!fs.existsSync(timelineOutPath)) {
      await new Promise((resolve, reject) => {
        const child = spawn('ffmpeg', [
          '-y',
          '-f',
          'concat',
          '-safe',
          '0',
          '-i',
          listFile,
          '-c',
          'copy',
          '-movflags',
          '+faststart',
          timelineOutPath
        ], { stdio: ['ignore', 'inherit', 'inherit'] });

        child.once('error', reject);
        child.once('exit', (code) => {
          if (code === 0) {
            resolve();
            return;
          }
          reject(new Error(`timeline_concat_failed_${code}`));
        });
      });
    }

    updateJob(jobId, {
      state: 'ready',
      progress: 100,
      downloadUrl: `${downloadBase}/${timelineFilename}`
    });
    if (typeof onReady === 'function') {
      await Promise.resolve(onReady({
        timelineFilename,
        timelineOutPath,
        timing: resolveTimingMetadata({
          job: jobs.get(jobId),
          fallback: {
            timing_mode: timelineTimingMode,
            timing_degraded: timelineTimingDegraded,
            timing_animations: timelineTimingAnimations,
            timing_hooks: timelineTimingHooks
          }
        })
      }));
    }
  } catch (error) {
    console.error(error);
    updateJob(jobId, { state: 'error', error: error.message || 'timeline_failed' });
    if (typeof onError === 'function') {
      onError(error, resolveTimingMetadata({
        job: jobs.get(jobId),
        fallback: {
          timing_mode: timelineTimingMode,
          timing_degraded: timelineTimingDegraded,
          timing_animations: timelineTimingAnimations,
          timing_hooks: timelineTimingHooks
        }
      }));
    }
  } finally {
    if (listFile) {
      try {
        fs.rmSync(listFile, { force: true });
      } catch (_) {
        // ignore tmp cleanup errors
      }
    }
    if (logStream) {
      logStream.end();
    }
  }
}

function buildProjectExportRelpath(projectId, jobId, filename) {
  return path.posix.join(
    'projects',
    safeName(projectId || ''),
    'exports',
    safeName(jobId || ''),
    filename
  );
}

function generatePreviewMp4({ inputPath, outputPath }) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', [
      '-y',
      '-i',
      inputPath,
      '-filter_complex',
      '[0:v]format=rgba[fg];color=c=black:s=16x16[bg];[bg][fg]scale2ref[bgm][fgm];[bgm][fgm]overlay=format=auto,format=yuv420p[vout]',
      '-map',
      '[vout]',
      '-map',
      '0:a?',
      '-c:v',
      'libx264',
      '-movflags',
      '+faststart',
      '-c:a',
      'aac',
      '-b:a',
      '160k',
      outputPath
    ], { stdio: ['ignore', 'inherit', 'inherit'] });

    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`preview_encode_failed_${code}`));
    });
  });
}

function startServer() {
  gcStages();
  gcProgramMonitorCache();
  pruneJobs();
  const renderMountState = getRendersDirDiagnostics({ rendersDir: RENDERS_DIR });
  console.log(`render-api workspace_dir=${WORKSPACE_DIR}`);
  console.log(`render-api renders_dir=${RENDERS_DIR} delivery_subdir=${DELIVERY_SUBDIR}`);
  console.log(`render-api deliver_exports=${DELIVER_EXPORTS ? 'enabled' : 'disabled'}`);
  if (PUBLIC_ORIGIN) {
    console.log(`render-api public_origin=${PUBLIC_ORIGIN}`);
  }
  console.log(`render-api render_origin=${DEFAULT_RENDER_ORIGIN}`);
  if (!renderMountState.writable) {
    console.error(`render-api renders_dir not writable: ${renderMountState.error || 'unknown_error'}`);
  }
  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      return json(res, 200, { ok: true });
    }

    const parsed = url.parse(req.url, true);

    if (req.method === 'GET' && parsed.pathname === '/api/health') {
      const diagnostics = getRendersDirDiagnostics({ rendersDir: RENDERS_DIR });
      if (DELIVER_EXPORTS && !diagnostics.writable) {
        return json(res, 500, { ok: false, renders: diagnostics });
      }
      return json(res, 200, { ok: true, renders: diagnostics });
    }

    if (req.method === 'GET' && parsed.pathname === '/api/debug/renders') {
      /**
       * Render mount diagnostics.
       *
       * Example:
       *   curl http://localhost:8791/api/debug/renders
       */
      const diagnostics = getRendersDirDiagnostics({ rendersDir: RENDERS_DIR });
      return json(res, 200, { ok: true, ...diagnostics });
    }

    if (req.method === 'POST' && parsed.pathname === '/api/debug/renders/touch') {
      /**
       * Write a file into /renders for mount validation.
       *
       * Example:
       *   curl -X POST http://localhost:8791/api/debug/renders/touch \
       *     -H "Content-Type: application/json" \
       *     -d '{"relpath":"probe.txt","content":"hello"}'
       */
      let body;
      try {
        body = await parseBody(req);
      } catch (err) {
        const status = err.message === 'payload_too_large' ? 413 : 400;
        return json(res, status, { ok: false, error: 'bad_json' });
      }
      const relpath = body?.relpath ? String(body.relpath) : '';
      if (!relpath || relpath.includes('..')) {
        return json(res, 400, { ok: false, error: 'invalid_relpath' });
      }
      const targetPath = path.join(RENDERS_DIR, relpath);
      try {
        writeFileAtomic(targetPath, body?.content ? String(body.content) : '');
        const stats = fs.statSync(targetPath);
        return json(res, 200, {
          ok: true,
          path: targetPath,
          size_bytes: stats.size,
          mtime: stats.mtime.toISOString()
        });
      } catch (error) {
        return json(res, 500, { ok: false, error: error.message || 'touch_failed' });
      }
    }

    if (req.method === 'GET' && parsed.pathname === '/api/renders') {
      const limit = parseOptionalNumber(parsed.query.limit);
      try {
        const renders = listRenderFiles({ limit });
        return json(res, 200, { ok: true, renders });
      } catch (err) {
        console.error(err);
        return json(res, 500, { ok: false, error: 'render_list_failed' });
      }
    }

    if (req.method === 'GET' && parsed.pathname.startsWith('/exports/')) {
      /**
       * Serve project export artifacts.
       *
       * Example:
       *   curl http://localhost:8791/exports/demo/job-123/render.mov
       */
      const parts = parsed.pathname.split('/').filter(Boolean);
      const projectId = parts[1];
      const jobId = parts[2];
      const filename = parts.slice(3).join('/');
      if (!projectId || !jobId || !filename) {
        return json(res, 404, { ok: false, error: 'export_not_found' });
      }
      const filePath = resolveExportFilePath({ projectId, jobId, filename });
      if (!filePath) {
        return json(res, 404, { ok: false, error: 'export_not_found' });
      }
      if (!fs.existsSync(filePath)) {
        return json(res, 404, { ok: false, error: 'export_not_found' });
      }
      const stats = fs.statSync(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const contentType = getExportContentType(filePath);
      const supportsRange = EXPORT_RANGE_EXTENSIONS.has(ext);
      if (supportsRange) {
        const rangeResponse = buildRangeResponse({
          rangeHeader: req.headers.range,
          size: stats.size,
          contentType
        });
        res.writeHead(rangeResponse.statusCode, {
          ...rangeResponse.headers,
          'Access-Control-Allow-Origin': '*'
        });
        if (rangeResponse.statusCode === 416) {
          res.end();
          return;
        }
        fs.createReadStream(filePath, {
          start: rangeResponse.start,
          end: rangeResponse.end
        }).pipe(res);
        return;
      }
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': stats.size,
        'Access-Control-Allow-Origin': '*'
      });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    if (req.method === 'GET' && parsed.pathname === '/api/projects') {
      /**
       * List Program Monitor projects from disk-backed project index.
       *
       * Example:
       *   curl http://localhost:8791/api/projects
       */
      const projects = readProjectIndex();
      return json(res, 200, { ok: true, projects });
    }

    if (req.method === 'POST' && parsed.pathname === '/api/projects:resolve') {
      /**
       * Resolve a project id from a human name, creating if absent.
       *
       * Example:
       *   curl -X POST http://localhost:8791/api/projects:resolve \
       *     -H "Content-Type: application/json" \
       *     -d '{"name":"Typewriter-1"}'
       */
      let body;
      try {
        body = await parseBody(req);
      } catch (err) {
        const status = err.message === 'payload_too_large' ? 413 : 400;
        return json(res, status, { ok: false, error: 'bad_json' });
      }
      try {
        const project = resolveProjectByName(body?.name || '');
        return json(res, 200, {
          ok: true,
          project_id: project.project_id,
          name: project.name,
          created_at: project.created_at,
          updated_at: project.updated_at,
          project
        });
      } catch (error) {
        return json(res, 400, { ok: false, error: error.message || 'project_resolve_failed' });
      }
    }

    const projectStateMatch = parsed.pathname.match(/^\/api\/projects\/([^/]+)$/);
    if (projectStateMatch) {
      const projectId = decodeURIComponent(projectStateMatch[1] || '');
      if (req.method === 'GET') {
        /**
         * Fetch canonical project editor state for a project id.
         *
         * Example:
         *   curl http://localhost:8791/api/projects/typewriter-1
         */
        const project = readProjectState(projectId);
        if (!project) {
          return json(res, 404, { ok: false, error: 'project_not_found' });
        }
        return json(res, 200, { ok: true, project });
      }
      if (req.method === 'PUT') {
        /**
         * Upsert canonical project editor state for a project id.
         *
         * Example:
         *   curl -X PUT http://localhost:8791/api/projects/typewriter-1 \
         *     -H "Content-Type: application/json" \
         *     -d '{"name":"Typewriter-1","payload":{"timeline":{"version":1,"nodes":[{"text":"http://nginx/plate-default.html"}]}}}'
         */
        let body;
        try {
          body = await parseBody(req);
        } catch (err) {
          const status = err.message === 'payload_too_large' ? 413 : 400;
          return json(res, status, { ok: false, error: 'bad_json' });
        }
        const existing = readProjectState(projectId);
        const name = normalizeProjectName(body?.name || existing?.name || projectId);
        const payload = body?.payload || (body?.timeline ? { timeline: body.timeline } : body);
        const timeline = normalizeProjectPayload(payload).timeline;
        if (!Array.isArray(timeline.nodes)) {
          return json(res, 400, { ok: false, error: 'missing_timeline_nodes' });
        }
        const project = saveProjectState({
          projectId,
          name,
          payload: { timeline }
        });
        return json(res, 200, { ok: true, project_id: projectId, project });
      }
      if (req.method === 'DELETE') {
        deleteProjectState(projectId);
        return json(res, 200, { ok: true, project_id: projectId });
      }
      return json(res, 405, { ok: false, error: 'method_not_allowed' });
    }

    const projectTimelineMatch = parsed.pathname.match(/^\/api\/projects\/([^/]+)\/timeline$/);
    if (projectTimelineMatch) {
      const projectId = decodeURIComponent(projectTimelineMatch[1] || '');
      if (req.method === 'GET') {
        /**
         * Fetch the draft timeline for a project.
         *
         * Example:
         *   curl http://localhost:8791/api/projects/demo/timeline
         */
        const timeline = getProjectTimeline(projectId);
        return json(res, 200, { ok: true, project_id: projectId, timeline });
      }
      if (req.method === 'PUT') {
        /**
         * Persist the draft timeline for a project.
         *
         * Example:
         *   curl -X PUT http://localhost:8791/api/projects/demo/timeline \
         *     -H "Content-Type: application/json" \
         *     -d '{"version":1,"nodes":[{"text":"http://nginx/plate-default.html"}],"activeIndex":0}'
         */
        let body;
        try {
          body = await parseBody(req);
        } catch (err) {
          const status = err.message === 'payload_too_large' ? 413 : 400;
          return json(res, status, { ok: false, error: 'bad_json' });
        }
        if (!body || !Array.isArray(body.nodes)) {
          return json(res, 400, { ok: false, error: 'missing_timeline_nodes' });
        }
        const timeline = normalizeProjectTimeline({
          version: Number.isFinite(body.version) ? body.version : 1,
          nodes: body.nodes,
          activeIndex: Number.isFinite(body.activeIndex) ? body.activeIndex : 0,
          nodesStructured: body.nodesStructured
        });
        try {
          atomicWriteJson(projectTimelinePath(projectId), timeline);
          const existing = readProjectState(projectId);
          saveProjectState({
            projectId,
            name: existing?.name || projectId,
            payload: { timeline }
          });
          const bytes = Buffer.byteLength(JSON.stringify(timeline));
          console.log(`DRAFT_SAVE project=${projectId} path=${projectTimelinePath(projectId)} bytes=${bytes}`);
        } catch (error) {
          console.error(`DRAFT_SAVE_FAILED project=${projectId}`, error);
          return json(res, 500, { ok: false, error: 'timeline_write_failed' });
        }
        return json(res, 200, { ok: true, project_id: projectId, timeline });
      }
      return json(res, 405, { ok: false, error: 'method_not_allowed' });
    }

    const projectExportsMatch = parsed.pathname.match(/^\/api\/projects\/([^/]+)\/exports$/);
    if (projectExportsMatch && req.method === 'GET') {
      /**
       * List export artifacts for a project.
       *
       * Example:
       *   curl http://localhost:8791/api/projects/demo/exports
       */
      const projectId = decodeURIComponent(projectExportsMatch[1] || '');
      try {
        const exportsList = listProjectExports(projectId).map((entry) => {
          const job = jobs.get(entry.job_id);
          const status = entry.error ? 'error' : (job ? job.state : 'ready');
          return {
            ...entry,
            status,
            progress: job ? job.progress : null,
            manifest_url: entry.manifest_url
              || `/exports/${encodeURIComponent(safeName(projectId))}/${encodeURIComponent(entry.job_id)}/manifest.json`,
            log_url: entry.log_url
              || `/exports/${encodeURIComponent(safeName(projectId))}/${encodeURIComponent(entry.job_id)}/render.log`,
            timing_mode: entry.timing_mode || job?.timingMode || null,
            timing_degraded: entry.timing_degraded ?? job?.timingDegraded ?? null,
            timing_animations: entry.timing_animations ?? job?.timingAnimations ?? null,
            timing_hooks: entry.timing_hooks ?? job?.timingHooks ?? null
          };
        });
        return json(res, 200, { ok: true, project_id: projectId, exports: exportsList });
      } catch (error) {
        console.error(error);
        return json(res, 500, { ok: false, error: 'exports_list_failed' });
      }
    }

    const projectExportsDeliveredMatch = parsed.pathname.match(/^\/api\/projects\/([^/]+)\/exports\/delivered$/);
    if (projectExportsDeliveredMatch && req.method === 'GET') {
      /**
       * List delivered export artifacts for a project (from /renders).
       *
       * Example:
       *   curl http://localhost:8791/api/projects/demo/exports/delivered
       */
      const projectId = decodeURIComponent(projectExportsDeliveredMatch[1] || '');
      try {
        const exportsList = listDeliveredExports(projectId, {
          rendersDir: RENDERS_DIR,
          subdir: DELIVERY_SUBDIR
        });
        return json(res, 200, { ok: true, project_id: projectId, exports: exportsList });
      } catch (error) {
        console.error(error);
        return json(res, 500, { ok: false, error: 'delivered_list_failed' });
      }
    }

    const projectExportDeliveryMatch = parsed.pathname.match(/^\/api\/projects\/([^/]+)\/exports\/([^/]+)\/delivery$/);
    if (projectExportDeliveryMatch && req.method === 'GET') {
      /**
       * Fetch delivery status for an export.
       *
       * Example:
       *   curl http://localhost:8791/api/projects/demo/exports/job-123/delivery
       */
      const projectId = decodeURIComponent(projectExportDeliveryMatch[1] || '');
      const jobId = decodeURIComponent(projectExportDeliveryMatch[2] || '');
      const status = buildDeliveryStatus({ projectId, jobId, rendersDir: RENDERS_DIR, subdir: DELIVERY_SUBDIR });
      return json(res, 200, { ok: true, ...status });
    }

    const projectExportDeliverMatch = parsed.pathname.match(/^\/api\/projects\/([^/]+)\/exports\/([^/]+)\/deliver$/);
    if (projectExportDeliverMatch && req.method === 'POST') {
      /**
       * Force delivery of export artifacts to /renders.
       *
       * Example:
       *   curl -X POST http://localhost:8791/api/projects/demo/exports/job-123/deliver
       */
      const projectId = decodeURIComponent(projectExportDeliverMatch[1] || '');
      const jobId = decodeURIComponent(projectExportDeliverMatch[2] || '');
      const jobDir = projectExportJobDir(projectId, jobId);
      const manifest = readJsonSafe(exportManifestPath(jobDir), null);
      if (!manifest) {
        return json(res, 404, { ok: false, error: 'export_not_found' });
      }
      const previewFilename = manifest.preview_url ? 'render_preview.mp4' : null;
      const deliveryResult = await deliverExportArtifacts({
        projectId,
        jobId,
        jobDir,
        filename: manifest.filename || 'render.mov',
        previewFilename
      });
      manifest.delivered = deliveryResult.delivered;
      manifest.delivered_error = deliveryResult.error || null;
      manifest.delivered_dir = deliveryResult.deliveredDir || null;
      manifest.delivered_files = deliveryResult.deliveredFiles || null;
      manifest.delivered_host_hint = deliveryResult.hostHint || null;
      atomicWriteJson(exportManifestPath(jobDir), manifest);
      if (deliveryResult.delivered && deliveryResult.deliveredFiles?.manifest) {
        writeFileAtomic(deliveryResult.deliveredFiles.manifest, JSON.stringify(manifest, null, 2));
      }
      return json(res, 200, { ok: true, ...deliveryResult });
    }

    if (req.method === 'POST' && parsed.pathname === '/api/program-monitor/stage') {
      /**
       * Create a Program Monitor stage cache entry.
       *
       * Example:
       *   curl -X POST http://localhost:8791/api/program-monitor/stage \
       *     -H "Content-Type: application/json" \
       *     -d '{"timeline":{"version":1,"nodes":[{"text":"http://nginx/plate-default.html"}]},"name":"Show Open"}'
       */
      let body;
      try {
        body = await parseBody(req);
      } catch (err) {
        const status = err.message === 'payload_too_large' ? 413 : 400;
        return json(res, status, { ok: false, error: 'bad_json' });
      }

      try {
        const entry = createStageEntry({
          payload: {
            timeline: body.timeline,
            name: body.name || '',
            createdBy: body.createdBy || 'program-monitor'
          }
        });
        return json(res, 200, { ok: true, stage_id: entry.id, expires_at: entry.expiresAt });
      } catch (error) {
        console.error(error);
        return json(res, 400, { ok: false, error: error.message || 'stage_create_failed' });
      }
    }

    if (req.method === 'GET' && parsed.pathname.startsWith('/api/program-monitor/stage/')) {
      /**
       * Fetch a Program Monitor stage cache entry.
       *
       * Example:
       *   curl http://localhost:8791/api/program-monitor/stage/<stage_id>
       */
      const stageId = parsed.pathname.split('/').pop();
      const entry = readStageEntry({ stageId });
      if (!entry) {
        return json(res, 404, { ok: false, error: 'stage_not_found' });
      }
      return json(res, 200, {
        ok: true,
        stage: {
          timeline: entry.payload?.timeline || null,
          name: entry.payload?.name || '',
          created_by: entry.payload?.createdBy || '',
          created_at: entry.createdAt,
          expires_at: entry.expiresAt
        }
      });
    }

    if (req.method === 'POST' && parsed.pathname === '/api/exports') {
      /**
       * Create a project export job (timeline MOV).
       *
       * Example:
       *   curl -X POST http://localhost:8791/api/exports \
       *     -H "Content-Type: application/json" \
       *     -d '{"project_id":"demo","stage_id":"abc123","format":"mov"}'
       */
      let body;
      try {
        body = await parseBody(req);
      } catch (err) {
        const status = err.message === 'payload_too_large' ? 413 : 400;
        return json(res, status, { ok: false, error: 'bad_json' });
      }
      const projectId = body?.project_id;
      if (!projectId) {
        return json(res, 400, { ok: false, error: 'missing_project_id' });
      }
      let timeline = body.timeline || null;
      if (!timeline && body.stage_id) {
        const stageEntry = readStageEntry({ stageId: body.stage_id });
        timeline = stageEntry?.payload?.timeline || null;
      }
      if (!timeline && body.project_id) {
        timeline = getProjectTimeline(projectId);
      }
      if (!timeline || !Array.isArray(timeline.nodes) || !timeline.nodes.length) {
        return json(res, 400, { ok: false, error: 'missing_timeline_nodes' });
      }

      const options = body.options || {};
      const fps = parseOptionalNumber(options.fps) ?? 60;
      const width = parseOptionalNumber(options.width) ?? 1080;
      const height = parseOptionalNumber(options.height) ?? 1920;
      const warmupMs = parseOptionalNumber(options.warmupMs);
      const padSeconds = parseOptionalNumber(options.padSeconds) ?? 0;
      const durationSeconds = parseOptionalNumber(options.duration_seconds);

      const jobId = createJobId();
      const jobDir = projectExportJobDir(projectId, jobId);
      const downloadBase = `/exports/${encodeURIComponent(safeName(projectId))}/${encodeURIComponent(jobId)}`;
      const debugFramePath = buildDebugFramePath({ projectId, jobId });
      const debugFrameFilename = debugFramePath ? path.basename(debugFramePath) : null;
      appendExportLog(jobDir, 'export_queued');

      const job = {
        id: jobId,
        state: 'queued',
        progress: 0,
        filename: 'render.mov',
        downloadUrl: null,
        error: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        projectId
      };

      jobs.set(jobId, job);
      writeJobFile(job);

      runTimelineJob({
        jobId,
        timeline,
        options: { fps, width, height, warmupMs, padSeconds, durationSeconds },
        outputDir: jobDir,
        filenamePrefix: 'render',
        outputFilename: 'render.mov',
        downloadBase,
        debugFramePath,
        logPath: exportLogPath(jobDir),
        onReady: async ({ timelineFilename, timelineOutPath, timing }) => {
          try {
            const stats = fs.statSync(timelineOutPath);
            const previewFilename = 'render_preview.mp4';
            const previewPath = path.join(jobDir, previewFilename);
            let previewUrl = '';
            if (!fs.existsSync(previewPath)) {
              try {
                await generatePreviewMp4({ inputPath: timelineOutPath, outputPath: previewPath });
              } catch (error) {
                console.warn('preview encode failed', error);
              }
            }
            if (fs.existsSync(previewPath)) {
              previewUrl = `${downloadBase}/${previewFilename}`;
            }
            const outputRelpath = buildProjectExportRelpath(projectId, jobId, timelineFilename);
            const outputName = `${safeName(projectId)}_${safeName(jobId)}.mov`;
            const manifest = {
              job_id: jobId,
              project_id: projectId,
              filename: timelineFilename,
              output_relpath: outputRelpath,
              output_name: outputName,
              debug_frame_filename: debugFrameFilename,
              debug_frame_path: debugFramePath,
              created_at: job.createdAt,
              finished_at: new Date().toISOString(),
              size_bytes: stats.size,
              download_url: `${downloadBase}/${timelineFilename}`,
              preview_url: previewUrl || null,
              status: 'ready',
              manifest_url: `${downloadBase}/manifest.json`,
              log_url: `${downloadBase}/render.log`,
              timing_mode: timing?.timing_mode ?? null,
              timing_degraded: timing?.timing_degraded ?? null,
              timing_animations: timing?.timing_animations ?? null,
              timing_hooks: timing?.timing_hooks ?? null
            };
            atomicWriteJson(exportManifestPath(jobDir), manifest);
            const deliveryResult = await deliverExportArtifacts({
              projectId,
              jobId,
              jobDir,
              filename: timelineFilename,
              previewFilename: previewUrl ? 'render_preview.mp4' : null,
              debugFrameFilename
            });
            manifest.delivered = deliveryResult.delivered;
            manifest.delivered_error = deliveryResult.error || null;
            manifest.delivered_dir = deliveryResult.deliveredDir || null;
            manifest.delivered_files = deliveryResult.deliveredFiles || null;
            manifest.delivered_host_hint = deliveryResult.hostHint || null;
            atomicWriteJson(exportManifestPath(jobDir), manifest);
            if (deliveryResult.delivered && deliveryResult.deliveredFiles?.manifest) {
              writeFileAtomic(deliveryResult.deliveredFiles.manifest, JSON.stringify(manifest, null, 2));
              const latestMarker = path.join(path.dirname(deliveryResult.deliveredFiles.manifest), '..', 'latest.json');
              writeFileAtomic(latestMarker, JSON.stringify({
                job_id: jobId,
                delivered_dir: deliveryResult.deliveredDir,
                manifest_path: deliveryResult.deliveredFiles.manifest,
                updated_at: new Date().toISOString()
              }, null, 2));
            }
            appendExportLog(jobDir, 'export_ready');
          } catch (error) {
            console.error(error);
          }
        },
        onError: (error, timing) => {
          const outputRelpath = buildProjectExportRelpath(projectId, jobId, 'render.mov');
          const outputName = `${safeName(projectId)}_${safeName(jobId)}.mov`;
          const manifest = {
            job_id: jobId,
            project_id: projectId,
            filename: 'render.mov',
            output_relpath: outputRelpath,
            output_name: outputName,
            debug_frame_filename: debugFrameFilename,
            debug_frame_path: debugFramePath,
            created_at: job.createdAt,
            finished_at: new Date().toISOString(),
            error: error?.message || 'export_failed',
            status: 'error',
            delivered: false,
            delivered_error: null,
            delivered_dir: resolveDeliveryDir({ projectId, jobId }) || null,
            delivered_files: null,
            delivered_host_hint: RENDERS_HOST_PATH_HINT || null,
            manifest_url: `${downloadBase}/manifest.json`,
            log_url: `${downloadBase}/render.log`,
            timing_mode: timing?.timing_mode ?? null,
            timing_degraded: timing?.timing_degraded ?? null,
            timing_animations: timing?.timing_animations ?? null,
            timing_hooks: timing?.timing_hooks ?? null
          };
          atomicWriteJson(exportManifestPath(jobDir), manifest);
          appendExportLog(jobDir, `export_error ${manifest.error}`);
        }
      });

      return json(res, 202, { ok: true, job_id: jobId, status_url: `/api/exports/${jobId}` });
    }

    if (req.method === 'GET' && parsed.pathname.startsWith('/api/exports/')) {
      /**
       * Fetch export job status.
       *
       * Example:
       *   curl http://localhost:8791/api/exports/<job_id>
       */
      const jobId = parsed.pathname.split('/').pop();
      const job = jobs.get(jobId);
      if (!job) {
        return json(res, 404, { ok: false, error: 'export_not_found' });
      }
      let manifest = null;
      if (job.projectId) {
        const jobDir = projectExportJobDir(job.projectId, job.id);
        manifest = readJsonSafe(exportManifestPath(jobDir), null);
      }
      return json(res, 200, {
        ok: true,
        job_id: job.id,
        state: job.state,
        progress: job.progress,
        filename: job.filename,
        download_url: job.downloadUrl || null,
        preview_url: manifest?.preview_url || null,
        output_name: manifest?.output_name || null,
        delivered: manifest?.delivered ?? null,
        delivered_error: manifest?.delivered_error || null,
        delivered_dir: manifest?.delivered_dir || null,
        delivered_files: manifest?.delivered_files || null,
        delivered_host_hint: manifest?.delivered_host_hint || null,
        error: job.error || null,
        project_id: job.projectId || null,
        manifest_url: job.projectId
          ? `/exports/${encodeURIComponent(safeName(job.projectId))}/${encodeURIComponent(job.id)}/manifest.json`
          : null,
        log_url: job.projectId
          ? `/exports/${encodeURIComponent(safeName(job.projectId))}/${encodeURIComponent(job.id)}/render.log`
          : null,
        timing_mode: manifest?.timing_mode || job.timingMode || null,
        timing_degraded: manifest?.timing_degraded ?? job.timingDegraded ?? null,
        timing_animations: manifest?.timing_animations ?? job.timingAnimations ?? null,
        timing_hooks: manifest?.timing_hooks ?? job.timingHooks ?? null
      });
    }

    if (req.method === 'GET' && parsed.pathname.startsWith('/api/render/')) {
      const jobId = parsed.pathname.split('/').pop();
      const job = jobs.get(jobId);
      if (!job) {
        return json(res, 404, { ok: false, error: 'job_not_found' });
      }
      return json(res, 200, {
        ok: true,
        job_id: job.id,
        state: job.state,
        progress: job.progress,
        filename: job.filename,
        download_url: job.downloadUrl || null,
        error: job.error || null,
        timing_mode: job.timingMode || null,
        timing_degraded: job.timingDegraded ?? null,
        timing_animations: job.timingAnimations ?? null,
        timing_hooks: job.timingHooks ?? null
      });
    }

    if (req.method === 'POST' && parsed.pathname === '/api/program-monitor/export-node') {
      /**
       * Export a Program Monitor node to MOV.
       *
       * Example:
       *   curl -X POST http://localhost:8791/api/program-monitor/export-node \
       *     -H "Content-Type: application/json" \
       *     -d '{"node":{"text":"http://nginx/plate-default.html"},"options":{"fps":60,"width":1080,"height":1920}}'
       */
      let body;
      try {
        body = await parseBody(req);
      } catch (err) {
        const status = err.message === 'payload_too_large' ? 413 : 400;
        return json(res, status, { ok: false, error: 'bad_json' });
      }

      const nodeText = body && body.node ? body.node.text : '';
      const parsedNode = parseProgramMonitorText(nodeText);
      if (!parsedNode.baseUrl) {
        return json(res, 400, { ok: false, error: 'missing_base_url' });
      }

      const normalizedBase = normalizeProgramMonitorUrl(parsedNode.baseUrl);
      if (!normalizedBase) {
        return json(res, 400, { ok: false, error: 'invalid_base_url' });
      }

      const normalizedLayers = parsedNode.layers
        .map((line) => normalizeProgramMonitorUrl(line))
        .filter(Boolean);
      try {
        assertRenderOriginSafe({
          urls: [normalizedBase, ...normalizedLayers],
          context: 'export_node'
        });
      } catch (error) {
        console.error(error);
        return json(res, 400, { ok: false, error: 'render_origin_invalid' });
      }

      const options = body.options || {};
      const fps = parseOptionalNumber(options.fps) ?? 60;
      const width = parseOptionalNumber(options.width) ?? 1080;
      const height = parseOptionalNumber(options.height) ?? 1920;
      const warmupMs = parseOptionalNumber(options.warmupMs);
      const padSeconds = parseOptionalNumber(options.padSeconds) ?? 0;
      const durationSeconds = parseOptionalNumber(options.duration_seconds)
        ?? parseOptionalNumber(body?.node?.duration_seconds);
      try {
        assertHtmlDurationSeconds({ url: normalizedBase, durationSeconds });
      } catch (error) {
        return json(res, 400, { ok: false, error: 'missing_duration_seconds' });
      }

      ensureDir(PROGRAM_MONITOR_TMP_DIR);
      ensureDir(PROGRAM_MONITOR_NODE_DIR);

      const nodeHash = buildProgramMonitorHash({
        baseUrl: normalizedBase,
        layers: normalizedLayers,
        fps,
        width,
        height,
        durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : null
      });

      const html = buildProgramMonitorHtml({
        baseUrl: normalizedBase,
        layers: normalizedLayers
      });
      const htmlFilename = `node-${nodeHash}.html`;
      const htmlPath = path.join(PROGRAM_MONITOR_TMP_DIR, htmlFilename);
      if (!fs.existsSync(htmlPath)) {
        fs.writeFileSync(htmlPath, html);
      }

      const filename = buildProgramMonitorFilename({
        prefix: 'program-monitor-node',
        hash: nodeHash,
        width,
        height,
        fps,
        seconds: Number.isFinite(durationSeconds) ? durationSeconds : null
      });
      const outPath = path.join(PROGRAM_MONITOR_NODE_DIR, filename);

      if (fs.existsSync(outPath)) {
        return json(res, 200, {
          ok: true,
          download_url: `/renders/program-monitor/nodes/${filename}`,
          state: 'ready'
        });
      }

      const jobId = createJobId();
      const job = {
        id: jobId,
        state: 'queued',
        progress: 0,
        filename,
        downloadUrl: null,
        error: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      jobs.set(jobId, job);
      writeJobFile(job);

      const targetUrl = `${DEFAULT_RENDER_ORIGIN}/renders/program-monitor/tmp/${htmlFilename}`;
      spawnRenderJob({
        jobId,
        url: targetUrl,
        outPath,
        fps,
        width,
        height,
        seconds: Number.isFinite(durationSeconds) ? durationSeconds : null,
        warmupMs,
        padSeconds
      });

      return json(res, 202, { ok: true, job_id: jobId, status_url: `/api/render/${jobId}` });
    }

    if (req.method === 'POST' && parsed.pathname === '/api/program-monitor/export-timeline') {
      /**
       * Export a Program Monitor timeline to MOV.
       *
       * Example:
       *   curl -X POST http://localhost:8791/api/program-monitor/export-timeline \
       *     -H "Content-Type: application/json" \
       *     -d '{"timeline":{"version":1,"nodes":[{"text":"http://nginx/plate-default.html"}]}}'
       */
      let body;
      try {
        body = await parseBody(req);
      } catch (err) {
        const status = err.message === 'payload_too_large' ? 413 : 400;
        return json(res, status, { ok: false, error: 'bad_json' });
      }

      const timeline = body.timeline;
      if (!timeline || !Array.isArray(timeline.nodes) || !timeline.nodes.length) {
        return json(res, 400, { ok: false, error: 'missing_timeline_nodes' });
      }

      const options = body.options || {};
      const fps = parseOptionalNumber(options.fps) ?? 60;
      const width = parseOptionalNumber(options.width) ?? 1080;
      const height = parseOptionalNumber(options.height) ?? 1920;
      const warmupMs = parseOptionalNumber(options.warmupMs);
      const padSeconds = parseOptionalNumber(options.padSeconds) ?? 0;

      ensureDir(PROGRAM_MONITOR_TIMELINE_DIR);
      const timelineHash = buildProgramMonitorTimelineHash(timeline, { fps, width, height });
      const existingFilename = buildProgramMonitorFilename({
        prefix: 'program-monitor-timeline',
        hash: timelineHash,
        width,
        height,
        fps,
        seconds: null
      });
      const existingPath = path.join(PROGRAM_MONITOR_TIMELINE_DIR, existingFilename);
      if (fs.existsSync(existingPath)) {
        return json(res, 200, {
          ok: true,
          download_url: `/renders/program-monitor/timelines/${existingFilename}`,
          state: 'ready'
        });
      }

      const jobId = createJobId();
      const job = {
        id: jobId,
        state: 'queued',
        progress: 0,
        filename: null,
        downloadUrl: null,
        error: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      jobs.set(jobId, job);
      writeJobFile(job);

      runTimelineJob({
        jobId,
        timeline,
        options: {
          fps,
          width,
          height,
          warmupMs,
          padSeconds
        },
        timelineHash
      });

      return json(res, 202, { ok: true, job_id: jobId, status_url: `/api/render/${jobId}` });
    }

    if (req.method === 'POST' && parsed.pathname === '/api/plates/render') {
      /**
       * Render an HTML overlay plate deterministically.
       *
       * Example:
       *   curl -X POST http://localhost:8791/api/plates/render \
       *     -H "Content-Type: application/json" \
       *     -d '{"url":"http://obs-plate/overlays/demo.html","duration":4,"fps":60,"width":1080,"height":1920}'
       */
      let body;
      try {
        body = await parseBody(req);
      } catch (err) {
        const status = err.message === 'payload_too_large' ? 413 : 400;
        return json(res, status, { ok: false, error: 'bad_json' });
      }

      const targetUrl = normalizeRenderUrl(body.url);
      if (!targetUrl) {
        return json(res, 400, { ok: false, error: 'missing_or_invalid_url' });
      }

      const requestedDuration = parseOptionalNumber(body.duration) ?? parseOptionalNumber(body.seconds);
      const fps = parseOptionalNumber(body.fps) ?? 60;
      const width = parseOptionalNumber(body.width) ?? 1080;
      const height = parseOptionalNumber(body.height) ?? 1920;
      const format = body.format === 'png-sequence' ? 'png-sequence' : 'webm-alpha';
      const plateName = safeName(body.name || 'html_plate');
      const plan = normalizeRenderPlanPayload(body) || {
        type: 'html_plate',
        url: targetUrl,
        fps,
        width,
        height,
        format,
        nodes: []
      };
      const planTiming = buildPlanTimingMetadata(plan);
      const duration = Number.isFinite(requestedDuration) && requestedDuration > 0
        ? requestedDuration
        : (planTiming.ready ? planTiming.total_duration_sec : Number.NaN);
      if (!Number.isFinite(duration) || duration <= 0) {
        return json(res, 400, { ok: false, error: 'missing_or_invalid_duration' });
      }

      const overlayApiVersion = String(body.overlay_api_version || process.env.OVERLAY_API_VERSION || '1');
      const ext = format === 'png-sequence' ? 'frames' : 'webm';
      const outFilename = `${plateName}_${Math.round(duration * 1000)}ms_${width}x${height}_${fps}fps.${ext}`;
      const outPath = path.join(RENDERS_DIR, 'plates', outFilename);

      try {
        const result = await render_html_plate(targetUrl, duration, fps, width, height, outPath, {
          format,
          overlayApiVersion,
          cacheDir: path.join(RENDERS_DIR, '.cache', 'html-plates')
        });

        plan.duration = duration;
        plan.url = plan.url || targetUrl;
        const plateStem = path.basename(outPath).replace(/\.[^.]+$/, '');
        const manifestPath = write_manifest(plan, path.dirname(outPath), {
          filename: `manifest.${plateStem}.json`,
          cache_key: result.cache_key,
          out_path: outPath,
          resolvedAssets: [{ type: 'html_overlay', url: targetUrl }],
          cacheKeys: { html_plate: result.cache_key },
          timing: {
            mode: 'frame_step',
            degraded: false,
            fps,
            frame_count: result.frame_count,
            duration_seconds: duration,
            duration_ms: Math.round(duration * 1000),
            start_time_seconds: 0,
            end_time_seconds: duration,
            total_duration_sec: planTiming.ready ? planTiming.total_duration_sec : duration,
            segments: planTiming.ready ? planTiming.segments : []
          }
        });

        return json(res, 200, {
          ok: true,
          state: result.cached ? 'ready_cached' : 'ready',
          plate_path: `/renders/plates/${outFilename}`,
          manifest_path: manifestPath,
          cache_key: result.cache_key,
          cached: result.cached
        });
      } catch (error) {
        console.error(error);
        return json(res, 500, { ok: false, error: error.message || 'plate_render_failed' });
      }
    }

    if (req.method !== 'POST' || parsed.pathname !== '/api/render') {
      return json(res, 404, { ok: false, error: 'not_found' });
    }

    let body;
    try {
      body = await parseBody(req);
    } catch (err) {
      const status = err.message === 'payload_too_large' ? 413 : 400;
      return json(res, status, { ok: false, error: 'bad_json' });
    }

    const targetUrl = normalizeRenderUrl(body.url);
    if (!targetUrl) {
      return json(res, 400, { ok: false, error: 'missing_or_invalid_url' });
    }

    const seconds = parseOptionalNumber(body.seconds);
    const fps = parseOptionalNumber(body.fps) ?? 60;
    const width = parseOptionalNumber(body.width) ?? 1080;
    const height = parseOptionalNumber(body.height) ?? 1920;
    const warmupMs = parseOptionalNumber(body.warmupMs);
    const padSeconds = parseOptionalNumber(body.padSeconds);

    const filename = buildFilename({ name: body.name || 'export', width, height, fps, seconds });
    const outPath = path.join(RENDERS_DIR, filename);

    fs.mkdirSync(RENDERS_DIR, { recursive: true });

    const jobId = createJobId();
    const job = {
      id: jobId,
      state: 'queued',
      progress: 0,
      filename,
      downloadUrl: null,
      error: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    jobs.set(jobId, job);
    writeJobFile(job);

    spawnRenderJob({
      jobId,
      url: targetUrl,
      outPath,
      fps,
      width,
      height,
      seconds,
      warmupMs,
      padSeconds
    });

    return json(res, 202, {
      ok: true,
      job_id: jobId,
      status_url: `/api/render/${jobId}`
    });
  });

  server.on('clientError', (err, socket) => {
    console.error(err);
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });

  const gcInterval = setInterval(() => {
    gcStages();
    gcProgramMonitorCache();
    pruneJobs();
  }, 5 * 60 * 1000);
  server.on('close', () => {
    clearInterval(gcInterval);
  });

  server.listen(PORT, () => {
    console.log(`render-api listening on :${PORT}`);
  });

  return server;
}

process.on('unhandledRejection', (err) => {
  console.error(err);
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  console.error(err);
  process.exit(1);
});

if (require.main === module) {
  startServer();
}

module.exports = {
  safeName,
  buildFilename,
  listRenderFiles,
  normalizeRenderUrl,
  assertRenderOriginSafe,
  parseProgramMonitorText,
  classifyProgramMonitorUrl,
  buildProgramMonitorFilename,
  buildProgramMonitorTimelineHash,
  assertHtmlDurationSeconds,
  createStageEntry,
  readStageEntry,
  writeStage,
  readStage,
  deleteStage,
  gcStages,
  pruneJobs,
  gcProgramMonitorCache,
  ensureProjectDir,
  readJsonSafe,
  atomicWriteJson,
  projectTimelinePath,
  projectStatePath,
  readProjectIndex,
  readProjectState,
  resolveProjectByName,
  saveProjectState,
  normalizeProjectTimeline,
  listProjectExports,
  getProjectTimeline,
  buildRangeResponse,
  resolveExportFilePath,
  deliverExportArtifacts,
  resolveDeliveryDir,
  buildDebugFramePath,
  buildProgramMonitorHtml,
  parseRenderTimingLine,
  normalizeRenderPlanPayload,
  resolveTimingMetadata,
  startServer
};
