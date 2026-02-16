/**
 * Render an HTML overlay URL into a deterministic plate artifact (WebM alpha or PNG sequence).
 *
 * Usage:
 *   const { render_html_plate } = require('./render/html_plate');
 *   await render_html_plate('http://obs-plate/overlays/demo.html', 4, 60, 1080, 1920, '/renders/demo.webm', { format: 'webm-alpha' });
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const DEFAULT_OVERLAY_API_VERSION = process.env.OVERLAY_API_VERSION || '1';

function build_html_plate_cache_key({
  url,
  duration,
  fps,
  width,
  height,
  format = 'webm-alpha',
  overlayApiVersion = DEFAULT_OVERLAY_API_VERSION
}) {
  const preimage = JSON.stringify({
    url: String(url || ''),
    duration: Number(duration),
    fps: Number(fps),
    width: Number(width),
    height: Number(height),
    format: String(format || ''),
    overlayApiVersion: String(overlayApiVersion)
  });
  return crypto
    .createHash('sha256')
    .update(preimage)
    .digest('hex');
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg_failed_${code}`));
      }
    });
  });
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function copyFileAtomic(sourcePath, targetPath) {
  ensureParentDir(targetPath);
  const tempPath = `${targetPath}.tmp`;
  fs.copyFileSync(sourcePath, tempPath);
  fs.renameSync(tempPath, targetPath);
}

async function captureFrames({ page, frameDir, frameCount, fps }) {
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const t = frameIndex / fps;
    await page.evaluate(async ({ tSeconds }) => {
      if (window.__TIMELINE__ && typeof window.__TIMELINE__.setTime === 'function') {
        window.__TIMELINE__.setTime(tSeconds);
      }
      if (typeof window.__SET_RENDER_TIME === 'function') {
        window.__SET_RENDER_TIME(Math.round(tSeconds * 1000));
      }
      window.__RENDER_T_MS = Math.round(tSeconds * 1000);
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));
    }, { tSeconds: t });

    const filename = `frame_${String(frameIndex).padStart(6, '0')}.png`;
    await page.screenshot({
      path: path.join(frameDir, filename),
      omitBackground: true
    });
  }
}

async function render_html_plate(url, duration, fps, width, height, out_path, opts = {}) {
  if (!url) {
    throw new Error('missing_url');
  }
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('invalid_duration');
  }

  const renderFps = Number.isFinite(fps) && fps > 0 ? fps : 60;
  const renderWidth = Number.isFinite(width) && width > 0 ? width : 1080;
  const renderHeight = Number.isFinite(height) && height > 0 ? height : 1920;
  const format = opts.format === 'png-sequence' ? 'png-sequence' : 'webm-alpha';
  const overlayApiVersion = opts.overlayApiVersion || DEFAULT_OVERLAY_API_VERSION;
  const cacheKey = build_html_plate_cache_key({
    url,
    duration,
    fps: renderFps,
    width: renderWidth,
    height: renderHeight,
    overlayApiVersion,
    format
  });
  const frameCount = Math.max(1, Math.round(duration * renderFps));
  const cacheDir = opts.cacheDir || null;
  const cacheExt = format === 'webm-alpha' ? 'webm' : 'zip';
  const cachePath = cacheDir ? path.join(cacheDir, `${cacheKey}.${cacheExt}`) : null;

  ensureParentDir(out_path);
  if (cachePath && fs.existsSync(cachePath)) {
    if (path.resolve(cachePath) !== path.resolve(out_path)) {
      copyFileAtomic(cachePath, out_path);
    }
    return { ok: true, out_path, cache_key: cacheKey, cached: true, frame_count: frameCount };
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'html-plate-'));
  const frameDir = path.join(tempRoot, 'frames');
  fs.mkdirSync(frameDir, { recursive: true });

  let browser;
  let page;
  try {
    const { chromium } = require('playwright');
    browser = await chromium.launch({ args: ['--disable-gpu', '--disable-dev-shm-usage'] });
    const context = await browser.newContext({ viewport: { width: renderWidth, height: renderHeight } });
    page = await context.newPage();
    await page.addInitScript(() => {
      window.__RENDER_CAPTURE = true;
    });
    await page.goto(url, { waitUntil: 'networkidle' });

    try {
      await page.waitForFunction(() => window.__RENDER_READY === true, { timeout: 5000 });
    } catch (_) {
      // Continue even when overlays don't define __RENDER_READY.
    }

    await captureFrames({ page, frameDir, frameCount, fps: renderFps });

    if (format === 'webm-alpha') {
      await runFfmpeg([
        '-y',
        '-framerate',
        String(renderFps),
        '-i',
        path.join(frameDir, 'frame_%06d.png'),
        '-c:v',
        'libvpx-vp9',
        '-pix_fmt',
        'yuva420p',
        '-auto-alt-ref',
        '0',
        out_path
      ]);
    } else {
      fs.mkdirSync(out_path, { recursive: true });
      for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
        const filename = `frame_${String(frameIndex).padStart(6, '0')}.png`;
        copyFileAtomic(path.join(frameDir, filename), path.join(out_path, filename));
      }
    }

    if (cachePath) {
      fs.mkdirSync(path.dirname(cachePath), { recursive: true });
      if (format === 'webm-alpha') {
        copyFileAtomic(out_path, cachePath);
      }
    }

    return { ok: true, out_path, cache_key: cacheKey, cached: false, frame_count: frameCount };
  } finally {
    if (page) {
      await page.close().catch(() => {});
    }
    if (browser) {
      await browser.close().catch(() => {});
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

module.exports = {
  build_html_plate_cache_key,
  render_html_plate
};
