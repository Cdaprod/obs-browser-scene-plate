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

function startServer() {
  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      return json(res, 200, { ok: true });
    }

    const parsed = url.parse(req.url, true);

    if (req.method === 'GET' && parsed.pathname === '/api/health') {
      return json(res, 200, { ok: true });
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

    const targetUrl = String(body.url || '').trim();
    if (!/^https?:\/\//.test(targetUrl)) {
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

    const args = [
      '/app/render.js',
      `--url=${targetUrl}`,
      `--out=${outPath}`,
      `--fps=${fps}`,
      `--width=${width}`,
      `--height=${height}`
    ];

    if (seconds !== null) {
      args.push(`--seconds=${seconds}`);
    }
    if (warmupMs !== null) {
      args.push(`--warmupMs=${warmupMs}`);
    }
    if (padSeconds !== null) {
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
              downloadUrl: `/renders/${filename}`
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
  startServer
};
