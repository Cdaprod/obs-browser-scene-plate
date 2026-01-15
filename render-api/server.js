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
 */
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = Number(process.env.PORT || 8791);
const RENDERS_DIR = process.env.RENDERS_DIR || '/renders';
const MAX_BODY_BYTES = 1024 * 1024;

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
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
  return `${base}_${width}x${height}_${fps}fps_${Math.round(seconds * 1000)}ms_${stamp}.mov`;
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

    const seconds = Number(body.seconds ?? 4);
    const fps = Number(body.fps ?? 60);
    const width = Number(body.width ?? 1080);
    const height = Number(body.height ?? 1920);

    const filename = buildFilename({ name: body.name || 'export', width, height, fps, seconds });
    const outPath = path.join(RENDERS_DIR, filename);

    fs.mkdirSync(RENDERS_DIR, { recursive: true });

    const args = [
      '/app/render.js',
      `--url=${targetUrl}`,
      `--out=${outPath}`,
      `--seconds=${seconds}`,
      `--fps=${fps}`,
      `--width=${width}`,
      `--height=${height}`
    ];

    let responded = false;
    const respondOnce = (code, payload) => {
      if (responded) return;
      responded = true;
      json(res, code, payload);
    };

    const child = spawn('node', args, { stdio: 'inherit' });

    child.once('error', (err) => {
      console.error(err);
      respondOnce(500, { ok: false, error: 'render_spawn_failed' });
    });

    child.once('exit', (code) => {
      if (code === 0) {
        return respondOnce(200, {
          ok: true,
          filename,
          download: `/renders/${filename}`
        });
      }
      return respondOnce(500, { ok: false, error: 'render_failed', code });
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
