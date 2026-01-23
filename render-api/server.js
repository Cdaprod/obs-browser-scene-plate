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

const PROGRAM_MONITOR_AUDIO_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.aac', '.ogg'];
const PROGRAM_MONITOR_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
const PROGRAM_MONITOR_VIDEO_EXTENSIONS = ['.mp4', '.mov', '.webm', '.mkv'];

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

async function runTimelineJob({ jobId, timeline, options, timelineHash }) {
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

    ensureDir(PROGRAM_MONITOR_TIMELINE_DIR);
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
    const timelineFilename = buildProgramMonitorFilename({
      prefix: 'program-monitor-timeline',
      hash: resolvedTimelineHash,
      width,
      height,
      fps,
      seconds: null
    });
    const timelineOutPath = path.join(PROGRAM_MONITOR_TIMELINE_DIR, timelineFilename);

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
      downloadUrl: `/renders/program-monitor/timelines/${timelineFilename}`
    });
  } catch (error) {
    console.error(error);
    updateJob(jobId, { state: 'error', error: error.message || 'timeline_failed' });
  }
}

function startServer() {
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
  startServer
};
