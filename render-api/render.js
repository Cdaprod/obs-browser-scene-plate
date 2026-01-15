/**
 * Render a URL to a ProRes MOV using Playwright screenshots + ffmpeg.
 *
 * Usage:
 *   node /app/render.js --url=http://nginx/plate-default.html --out=/renders/output.mov \
 *     --seconds=4 --fps=60 --width=1080 --height=1920 --padSeconds=0.25 --warmupMs=250
 *
 * Example:
 *   node /app/render.js --url=http://nginx/overlays/scene_overlay_stack_v1.html \
 *     --out=/renders/overlay.mov --fps=60 --padSeconds=0.5 --warmupMs=500
 */
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');

const {
  DEFAULT_PAD_SECONDS,
  DEFAULT_SECONDS,
  inferDurationFromQuery,
  parseArgs,
  parseOptionalNumber,
  resolveRenderSeconds
} = require('./render-utils');

const DEFAULT_WARMUP_MS = 250;

function exitWithError(message, code = 1) {
  console.error(message);
  process.exit(code);
}

async function readDurationFromPage(page) {
  return page.evaluate(() => {
    const direct = Number(window.__RENDER_SECONDS);
    if (Number.isFinite(direct) && direct > 0) {
      return direct;
    }

    const meta = document.querySelector('meta[name="render:seconds"]');
    if (meta) {
      const content = Number(meta.getAttribute('content'));
      if (Number.isFinite(content) && content > 0) {
        return content;
      }
    }

    const eventSeconds = Number(window.__RENDER_SECONDS_EVENT);
    if (Number.isFinite(eventSeconds) && eventSeconds > 0) {
      return eventSeconds;
    }

    return null;
  });
}

async function render() {
  const args = parseArgs(process.argv.slice(2));

  const URL = args.url;
  const OUT = args.out || '/renders/output.mov';
  const FPS = parseInt(args.fps || '60', 10);
  const WIDTH = parseInt(args.width || '1920', 10);
  const HEIGHT = parseInt(args.height || '1080', 10);
  const explicitSeconds = parseOptionalNumber(args.seconds);
  const warmupMs = parseOptionalNumber(args.warmupMs) ?? DEFAULT_WARMUP_MS;
  const padSeconds = parseOptionalNumber(args.padSeconds) ?? DEFAULT_PAD_SECONDS;

  if (!URL) {
    exitWithError('Missing required: --url=http://...', 2);
  }

  const querySeconds = inferDurationFromQuery(URL);
  const FRAME_DIR = '/tmp/frames';

  fs.mkdirSync(FRAME_DIR, { recursive: true });

  const browser = await chromium.launch({
    args: ['--disable-gpu', '--disable-dev-shm-usage']
  });

  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1
  });

  const page = await context.newPage();

  await page.addInitScript(() => {
    window.__RENDER_SECONDS_EVENT = null;
    window.addEventListener('render:duration', (event) => {
      const seconds = event && event.detail ? Number(event.detail.seconds) : NaN;
      if (Number.isFinite(seconds) && seconds > 0) {
        window.__RENDER_SECONDS_EVENT = seconds;
      }
    }, { once: true });
  });

  await page.goto(URL, { waitUntil: 'load' });
  if (warmupMs > 0) {
    await page.waitForTimeout(warmupMs);
  }

  const pageSeconds = await readDurationFromPage(page);
  const SECONDS = resolveRenderSeconds({
    explicitSeconds,
    pageSeconds,
    querySeconds,
    padSeconds,
    defaultSeconds: DEFAULT_SECONDS
  });

  const FRAMES = Math.max(1, Math.round(FPS * SECONDS));

  console.log('RENDER_STATE:rendering');
  const frameIntervalMs = 1000 / FPS;
  const captureStart = Date.now();

  for (let i = 0; i < FRAMES; i++) {
    const n = String(i).padStart(5, '0');
    await page.screenshot({
      path: `${FRAME_DIR}/frame_${n}.png`,
      omitBackground: true
    });

    const targetTime = captureStart + (i + 1) * frameIntervalMs;
    const drift = targetTime - Date.now();
    if (drift > 0) {
      await page.waitForTimeout(drift);
    }
  }

  await browser.close();

  try {
    console.log('RENDER_STATE:encoding');
    execSync(
      `ffmpeg -y -framerate ${FPS} ` +
      `-i ${FRAME_DIR}/frame_%05d.png ` +
      `-c:v prores_ks -profile:v 4 -pix_fmt yuva444p10le ` +
      `-movflags +faststart ${OUT}`,
      { stdio: 'inherit' }
    );
  } catch (err) {
    console.error('ffmpeg failed to encode frames.');
    console.error(err);
    process.exit(3);
  }
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
  render().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  inferDurationFromQuery,
  parseArgs,
  parseOptionalNumber,
  resolveRenderSeconds,
  DEFAULT_PAD_SECONDS,
  DEFAULT_SECONDS
};
