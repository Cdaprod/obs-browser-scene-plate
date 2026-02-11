/**
 * Render a URL to an H.264 MOV using Playwright screenshots + ffmpeg.
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
const os = require('os');
const path = require('path');

const {
  DEFAULT_PAD_SECONDS,
  DEFAULT_SECONDS,
  inferDurationFromQuery,
  parseArgs,
  parseOptionalNumber,
  resolveRenderSeconds,
  buildVirtualTimePolicyPayload
} = require('./render-utils');

const DEFAULT_WARMUP_MS = 250;
const VIRTUAL_TIME_EVENT = 'Emulation.virtualTimeBudgetExpired';
const VIRTUAL_TIME_ADVANCE_POLICY = 'pauseIfNetworkFetchesPending';

function exitWithError(message, code = 1) {
  console.error(message);
  process.exit(code);
}

async function setVirtualTimePolicy(cdp, { policy, budget = null } = {}) {
  return cdp.send('Emulation.setVirtualTimePolicy', buildVirtualTimePolicyPayload({ policy, budget }));
}

async function setupVirtualTimeClock(cdp) {
  await setVirtualTimePolicy(cdp, { policy: 'pause' });
}

async function advanceVirtualTimeBy(cdp, deltaMs) {
  const budget = Math.max(1, Math.ceil(deltaMs));
  await new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      cdp.off(VIRTUAL_TIME_EVENT, onBudgetExpired);
      reject(new Error('virtual_time_budget_timeout'));
    }, Math.max(2000, budget * 2));

    function onBudgetExpired() {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      cdp.off(VIRTUAL_TIME_EVENT, onBudgetExpired);
      resolve();
    }

    cdp.on(VIRTUAL_TIME_EVENT, onBudgetExpired);
    setVirtualTimePolicy(cdp, { policy: VIRTUAL_TIME_ADVANCE_POLICY, budget }).catch((error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      cdp.off(VIRTUAL_TIME_EVENT, onBudgetExpired);
      reject(error);
    });
  });
  await setVirtualTimePolicy(cdp, { policy: 'pause' });
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
  const debugFrameOut = process.env.DEBUG_FRAME_OUT || null;
  const debugFramesEnabled = process.env.DEBUG_FRAMES === '1';

  if (!URL) {
    exitWithError('Missing required: --url=http://...', 2);
  }

  const querySeconds = inferDurationFromQuery(URL);
  const FRAME_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'render-frames-'));
  let browser;
  let page;
  let virtualClockEnabled = false;

  try {
    browser = await chromium.launch({
      args: ['--disable-gpu', '--disable-dev-shm-usage']
    });

    const context = await browser.newContext({
      viewport: { width: WIDTH, height: HEIGHT },
      deviceScaleFactor: 1
    });

    page = await context.newPage();
    let cdp = null;

    page.on('console', (msg) => {
      console.log(`BROWSER_CONSOLE:${msg.type()} ${msg.text()}`);
    });

    page.on('pageerror', (error) => {
      console.error(`BROWSER_PAGEERROR:${error.message || error}`);
    });

    await page.addInitScript(() => {
      window.__RENDER_SECONDS_EVENT = null;
      window.addEventListener('render:duration', (event) => {
        const seconds = event && event.detail ? Number(event.detail.seconds) : NaN;
        if (Number.isFinite(seconds) && seconds > 0) {
          window.__RENDER_SECONDS_EVENT = seconds;
        }
      }, { once: true });
    });

    await page.goto(URL, { waitUntil: 'networkidle' });
    try {
      await page.waitForFunction(() => window.__RENDER_READY === true, { timeout: 5000 });
    } catch (error) {
      console.error('RENDER_STATE:ready_timeout');
      throw new Error('render_ready_timeout');
    }
    if (debugFrameOut) {
      fs.mkdirSync(path.dirname(debugFrameOut), { recursive: true });
      await page.screenshot({
        path: debugFrameOut,
        omitBackground: true,
        fullPage: false
      });
      console.log(`RENDER_STATE:debug_frame path=${debugFrameOut}`);
    }
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
    console.log(`RENDER_STATE:frames fps=${FPS} seconds=${SECONDS} frames=${FRAMES}`);
    console.log(`CAPTURE url=${URL} duration_sec=${SECONDS} fps=${FPS} frames_total=${FRAMES}`);

    console.log('RENDER_STATE:rendering');
    const frameIntervalMs = 1000 / FPS;
    const debugFramesDir = debugFramesEnabled ? path.join(path.dirname(OUT), 'debug_frames') : null;
    if (debugFramesDir) {
      fs.mkdirSync(debugFramesDir, { recursive: true });
    }

    try {
      cdp = await context.newCDPSession(page);
      await setupVirtualTimeClock(cdp);
      virtualClockEnabled = true;
      console.log('RENDER_STATE:virtual_time enabled');
    } catch (error) {
      virtualClockEnabled = false;
      cdp = null;
      console.warn(`RENDER_STATE:virtual_time disabled reason=${error.message || error}`);
    }

    await page.evaluate(({ fps, frames }) => {
      const durationMs = Math.round((frames * 1000) / fps);
      window.__RENDER_DUR_MS = durationMs;
      const baseFrame = document.getElementById('base');
      if (baseFrame && baseFrame.contentWindow) {
        baseFrame.contentWindow.__RENDER_DUR_MS = durationMs;
      }
    }, { fps: FPS, frames: FRAMES });

    for (let i = 0; i < FRAMES; i++) {
      if (virtualClockEnabled && cdp && i > 0) {
        await advanceVirtualTimeBy(cdp, frameIntervalMs);
      }
      const n = String(i).padStart(5, '0');
      const frameTimeMs = Math.round(i * frameIntervalMs);
      await page.evaluate(({ tMs, frameIndex, frames, fps }) => {
        const baseFrame = document.getElementById('base');
        const targets = [window];
        if (baseFrame && baseFrame.contentWindow && baseFrame.contentWindow !== window) {
          targets.push(baseFrame.contentWindow);
        }
        targets.forEach((target) => {
          if (typeof target.__RENDER_SET_FRAME === 'function') {
            target.__RENDER_SET_FRAME(frameIndex, frames, fps);
          }
          if (typeof target.__SET_RENDER_TIME === 'function') {
            target.__SET_RENDER_TIME(tMs);
          }
          target.__RENDER_T_MS = tMs;
        });
      }, { tMs: frameTimeMs, frameIndex: i, frames: FRAMES, fps: FPS });
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
      await page.screenshot({
        path: `${FRAME_DIR}/frame_${n}.png`,
        omitBackground: true
      });

      if (!virtualClockEnabled) {
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
        await page.waitForTimeout(frameIntervalMs);
      }

      if (debugFramesDir && (i === 0 || i === FRAMES - 1)) {
        const debugName = i === 0 ? 'frame_00000.png' : 'frame_last.png';
        await page.screenshot({
          path: path.join(debugFramesDir, debugName),
          omitBackground: true
        });
      }
    }

    console.log('RENDER_STATE:encoding');
    execSync(
      `ffmpeg -y -framerate ${FPS} ` +
      `-i ${FRAME_DIR}/frame_%05d.png ` +
      `-c:v libx264 -pix_fmt yuv420p -profile:v high -level 4.1 ` +
      `-movflags +faststart ${OUT}`,
      { stdio: 'inherit' }
    );
  } catch (err) {
    if (OUT && fs.existsSync(OUT)) {
      fs.rmSync(OUT, { force: true });
    }
    if (err && err.stderr) {
      console.error(err.stderr.toString());
    }
    if (err && err.message && err.message.includes('ffmpeg')) {
      err.exitCode = 3;
    }
    throw err;
  } finally {
    if (page) {
      await page.close().catch(() => {});
    }
    if (browser) {
      await browser.close().catch(() => {});
    }
    fs.rmSync(FRAME_DIR, { recursive: true, force: true });
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
    process.exit(err.exitCode || 1);
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
