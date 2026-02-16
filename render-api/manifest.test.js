const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { write_manifest } = require('./timeline/manifest');
const { build_html_plate_cache_key } = require('./render/html_plate');
const { normalizeRenderPlanPayload } = require('./server');

test('write_manifest includes plan, assets, cache keys, and timing metadata', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-test-'));
  try {
    const plan = {
      id: 'plan-1',
      nodes: [{ id: 'n1', type: 'html' }],
      metadata: { requestedBy: 'test' }
    };
    const manifestPath = write_manifest(plan, tempDir, {
      resolvedAssets: [{ type: 'html_overlay', url: 'http://obs-plate/overlays/demo.html' }],
      cacheKeys: { html_plate: 'abc123' },
      timing: { mode: 'frame_step', fps: 60, frame_count: 120, duration_seconds: 2 }
    });

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.deepEqual(manifest.render_plan, plan);
    assert.equal(manifest.resolved_assets.length, 1);
    assert.equal(manifest.cache_keys.html_plate, 'abc123');
    assert.equal(manifest.timing.mode, 'frame_step');
    assert.equal(manifest.timing.fps, 60);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('build_html_plate_cache_key is deterministic for identical inputs', () => {
  const a = build_html_plate_cache_key({
    url: 'http://obs-plate/overlays/demo.html',
    duration: 4,
    fps: 60,
    width: 1080,
    height: 1920,
    overlayApiVersion: '1'
  });
  const b = build_html_plate_cache_key({
    url: 'http://obs-plate/overlays/demo.html',
    duration: 4,
    fps: 60,
    width: 1080,
    height: 1920,
    overlayApiVersion: '1'
  });
  const c = build_html_plate_cache_key({
    url: 'http://obs-plate/overlays/demo.html',
    duration: 5,
    fps: 60,
    width: 1080,
    height: 1920,
    overlayApiVersion: '1'
  });

  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('normalizeRenderPlanPayload only resolves payload-local plan keys', () => {
  assert.equal(normalizeRenderPlanPayload(null), null);
  const payloadPlan = { plan: { id: 'p-1' } };
  assert.deepEqual(normalizeRenderPlanPayload(payloadPlan), { id: 'p-1' });
  const payloadRenderPlan = { render_plan: { id: 'rp-1' } };
  assert.deepEqual(normalizeRenderPlanPayload(payloadRenderPlan), { id: 'rp-1' });
});

test('html_plate source applies deterministic timeline setTime stepping', () => {
  const source = fs.readFileSync(path.resolve(__dirname, 'render/html_plate.js'), 'utf8');
  assert.ok(source.includes('const t = frameIndex / fps;'));
  assert.ok(source.includes('window.__TIMELINE__.setTime(tSeconds)'));
});
