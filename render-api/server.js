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
const path = require('path');
const url = require('url');

const PORT = Number(process.env.PORT || 8791);
const RENDERS_DIR = process.env.RENDERS_DIR || '/renders';
const JOBS_DIR = path.join(RENDERS_DIR, '.jobs');
const MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_RENDER_ORIGIN = process.env.RENDER_ORIGIN || 'http://obs_plate';
const PROGRAM_MONITOR_DIR = path.join(RENDERS_DIR, 'program-monitor');
const PROGRAM_MONITOR_TMP_DIR = path.join(PROGRAM_MONITOR_DIR, 'tmp');
const PROGRAM_MONITOR_NODE_DIR = path.join(PROGRAM_MONITOR_DIR, 'nodes');
const PROGRAM_MONITOR_TIMELINE_DIR = path.join(PROGRAM_MONITOR_DIR, 'timelines');
const STAGE_TTL_SECONDS = Number(process.env.STAGE_TTL_SECONDS || 60 * 60 * 6);
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || path.join(RENDERS_DIR, 'workspace');
const PROJECTS_DIR = path.join(WORKSPACE_DIR, 'projects');
const STAGE_DIR = path.join(WORKSPACE_DIR, 'stage');

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
  if (PROGRAM_MONITOR_VIDEO_EXTENSIONS.some((ext) => pathname.endsWith(ext))) {
    return 'video';
  }
  return 'video';
}

function normalizeProgramMonitorUrl(value) {
  return normalizeRenderUrl(value);
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

function buildProgramMonitorTimelineHash(timeline, { fps, width, height }) {
  return buildProgramMonitorHash({
    nodes: (timeline.nodes || []).map((node) => node.text || ''),
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
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    console.warn('readJsonSafe failed', error);
    return fallback;
  }
}

function atomicWriteJson(filePath, data) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
  fs.renameSync(tempPath, filePath);
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
  return readJsonSafe(projectTimelinePath(projectId), {
    version: 1,
    nodes: [],
    activeIndex: 0
  });
}

function buildProgramMonitorHtml({ baseUrl, layers }) {
  const overlayMarkup = layers
    .map((url, index) => {
      const kind = classifyProgramMonitorUrl(url);
      if (kind === 'audio') {
        return `<audio data-layer="audio-${index}" src="${url}" loop></audio>`;
      }
      if (kind === 'image') {
        return `<img data-layer="image-${index}" src="${url}" alt="" />`;
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
    video, img {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
  </style>
</head>
<body>
  <div class="stage">
    <video id="base" src="${baseUrl}" playsinline muted></video>
    ${overlayMarkup}
  </div>
  <script>
    const base = document.getElementById('base');
    const overlays = Array.from(document.querySelectorAll('video[data-layer]'));
    const audios = Array.from(document.querySelectorAll('audio[data-layer]'));

    function startPlayback() {
      base.play().catch(() => {});
      overlays.forEach((video) => video.play().catch(() => {}));
      audios.forEach((audio) => audio.play().catch(() => {}));
    }

    base.addEventListener('loadedmetadata', () => {
      const duration = Number(base.duration);
      if (Number.isFinite(duration) && duration > 0) {
        window.__RENDER_SECONDS = duration;
        window.dispatchEvent(new CustomEvent('render:duration', { detail: { seconds: duration } }));
      }
      startPlayback();
    });

    window.addEventListener('load', () => {
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

function normalizeRenderUrl(inputUrl, { renderOrigin = DEFAULT_RENDER_ORIGIN } = {}) {
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
  onReady,
  onError
}) {
  try {
    const fps = options.fps;
    const width = options.width;
    const height = options.height;
    const warmupMs = options.warmupMs ?? null;
    const padSeconds = options.padSeconds ?? null;
    const nodes = timeline.nodes || [];

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

      const nodeHash = buildProgramMonitorHash({
        baseUrl: normalizedBase,
        layers: normalizedLayers,
        fps,
        width,
        height
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
        seconds: null
      });
      const nodeOutPath = path.join(PROGRAM_MONITOR_NODE_DIR, nodeFilename);

      if (!fs.existsSync(nodeOutPath)) {
        await new Promise((resolve, reject) => {
          const child = spawn('node', [
            '/app/render.js',
            `--url=${DEFAULT_RENDER_ORIGIN}/renders/program-monitor/tmp/${path.basename(htmlPath)}`,
            `--out=${nodeOutPath}`,
            `--fps=${fps}`,
            `--width=${width}`,
            `--height=${height}`
          ], { stdio: ['ignore', 'inherit', 'inherit'] });

          child.once('error', reject);
          child.once('exit', (code) => {
            if (code === 0) {
              resolve();
              return;
            }
            reject(new Error(`node_render_failed_${index}_${code}`));
          });
        });
      }

      nodeOutputs.push(nodeOutPath);
      const progress = Math.round(((index + 1) / nodes.length) * 90);
      updateJob(jobId, { progress });
    }

    updateJob(jobId, { state: 'encoding', progress: 95 });

    ensureDir(outputDir);
    const listFile = path.join(PROGRAM_MONITOR_TMP_DIR, `timeline-${jobId}.txt`);
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
      await Promise.resolve(onReady({ timelineFilename, timelineOutPath }));
    }
  } catch (error) {
    console.error(error);
    updateJob(jobId, { state: 'error', error: error.message || 'timeline_failed' });
    if (typeof onError === 'function') {
      onError(error);
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
      '-map',
      '0:v:0',
      '-map',
      '0:a?',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
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
  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      return json(res, 200, { ok: true });
    }

    const parsed = url.parse(req.url, true);

    if (req.method === 'GET' && parsed.pathname === '/api/health') {
      return json(res, 200, { ok: true });
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
      const safeProject = safeName(projectId);
      const safeJob = safeName(jobId);
      const filePath = path.join(PROJECTS_DIR, safeProject, 'exports', safeJob, filename);
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
        const timeline = {
          version: Number.isFinite(body.version) ? body.version : 1,
          nodes: body.nodes,
          activeIndex: Number.isFinite(body.activeIndex) ? body.activeIndex : 0
        };
        try {
          atomicWriteJson(projectTimelinePath(projectId), timeline);
        } catch (error) {
          console.error(error);
          return json(res, 500, { ok: false, error: 'timeline_write_failed' });
        }
        return json(res, 200, { ok: true, project_id: projectId });
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
            manifest_url: entry.manifest_url
              || `/exports/${encodeURIComponent(safeName(projectId))}/${encodeURIComponent(entry.job_id)}/manifest.json`,
            log_url: entry.log_url
              || `/exports/${encodeURIComponent(safeName(projectId))}/${encodeURIComponent(entry.job_id)}/render.log`
          };
        });
        return json(res, 200, { ok: true, project_id: projectId, exports: exportsList });
      } catch (error) {
        console.error(error);
        return json(res, 500, { ok: false, error: 'exports_list_failed' });
      }
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
      const padSeconds = parseOptionalNumber(options.padSeconds);

      const jobId = createJobId();
      const jobDir = projectExportJobDir(projectId, jobId);
      const downloadBase = `/exports/${encodeURIComponent(safeName(projectId))}/${encodeURIComponent(jobId)}`;
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
        options: { fps, width, height, warmupMs, padSeconds },
        outputDir: jobDir,
        filenamePrefix: 'render',
        outputFilename: 'render.mov',
        downloadBase,
        onReady: async ({ timelineFilename, timelineOutPath }) => {
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
              created_at: job.createdAt,
              finished_at: new Date().toISOString(),
              size_bytes: stats.size,
              download_url: `${downloadBase}/${timelineFilename}`,
              preview_url: previewUrl || null,
              status: 'ready',
              manifest_url: `${downloadBase}/manifest.json`,
              log_url: `${downloadBase}/render.log`
            };
            atomicWriteJson(exportManifestPath(jobDir), manifest);
            appendExportLog(jobDir, 'export_ready');
          } catch (error) {
            console.error(error);
          }
        },
        onError: (error) => {
          const outputRelpath = buildProjectExportRelpath(projectId, jobId, 'render.mov');
          const outputName = `${safeName(projectId)}_${safeName(jobId)}.mov`;
          const manifest = {
            job_id: jobId,
            project_id: projectId,
            filename: 'render.mov',
            output_relpath: outputRelpath,
            output_name: outputName,
            created_at: job.createdAt,
            finished_at: new Date().toISOString(),
            error: error?.message || 'export_failed',
            status: 'error',
            manifest_url: `${downloadBase}/manifest.json`,
            log_url: `${downloadBase}/render.log`
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
        error: job.error || null,
        project_id: job.projectId || null,
        manifest_url: job.projectId
          ? `/exports/${encodeURIComponent(safeName(job.projectId))}/${encodeURIComponent(job.id)}/manifest.json`
          : null,
        log_url: job.projectId
          ? `/exports/${encodeURIComponent(safeName(job.projectId))}/${encodeURIComponent(job.id)}/render.log`
          : null
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
        error: job.error || null
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

      const options = body.options || {};
      const fps = parseOptionalNumber(options.fps) ?? 60;
      const width = parseOptionalNumber(options.width) ?? 1080;
      const height = parseOptionalNumber(options.height) ?? 1920;
      const warmupMs = parseOptionalNumber(options.warmupMs);
      const padSeconds = parseOptionalNumber(options.padSeconds);

      ensureDir(PROGRAM_MONITOR_TMP_DIR);
      ensureDir(PROGRAM_MONITOR_NODE_DIR);

      const nodeHash = buildProgramMonitorHash({
        baseUrl: normalizedBase,
        layers: normalizedLayers,
        fps,
        width,
        height
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
        seconds: null
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
        seconds: null,
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
      const padSeconds = parseOptionalNumber(options.padSeconds);

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
  parseProgramMonitorText,
  classifyProgramMonitorUrl,
  buildProgramMonitorFilename,
  createStageEntry,
  readStageEntry,
  writeStage,
  readStage,
  deleteStage,
  gcStages,
  ensureProjectDir,
  readJsonSafe,
  atomicWriteJson,
  projectTimelinePath,
  listProjectExports,
  getProjectTimeline,
  buildRangeResponse,
  startServer
};
