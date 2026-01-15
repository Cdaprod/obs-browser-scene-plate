/**
 * Render a URL to a ProRes MOV using Playwright screenshots + ffmpeg.
 *
 * Usage:
 *   node /app/render.js --url=http://nginx/plate-default.html --out=/renders/output.mov \
 *     --seconds=4 --fps=60 --width=1080 --height=1920
 *
 * Example:
 *   node /app/render.js --url=http://nginx/overlays/scene_overlay_stack_v1.html \
 *     --out=/renders/overlay.mov --seconds=5 --fps=60
 */
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function exitWithError(message, code = 1) {
  console.error(message);
  process.exit(code);
}

const args = parseArgs(process.argv.slice(2));

const URL = args.url;
const OUT = args.out || '/renders/output.mov';
const FPS = parseInt(args.fps || '60', 10);
const SECONDS = parseFloat(args.seconds || '4');
const WIDTH = parseInt(args.width || '1920', 10);
const HEIGHT = parseInt(args.height || '1080', 10);

const FRAMES = Math.max(1, Math.floor(FPS * SECONDS));
const FRAME_DIR = '/tmp/frames';

async function render() {
  if (!URL) {
    exitWithError('Missing required: --url=http://...', 2);
  }

  fs.mkdirSync(FRAME_DIR, { recursive: true });

  const browser = await chromium.launch({
    args: ['--disable-gpu', '--disable-dev-shm-usage']
  });

  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT }
  });

  const page = await context.newPage();

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(250);

  for (let i = 0; i < FRAMES; i++) {
    const n = String(i).padStart(5, '0');
    await page.screenshot({
      path: `${FRAME_DIR}/frame_${n}.png`,
      omitBackground: true
    });
    await page.waitForTimeout(1000 / FPS);
  }

  await browser.close();

  try {
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

render().catch((err) => {
  console.error(err);
  process.exit(1);
});
