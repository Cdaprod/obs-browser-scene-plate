const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  inferDurationFromQuery,
  resolveRenderSeconds,
  buildVirtualTimePolicyPayload
} = require('./render-utils');

test('inferDurationFromQuery prefers seconds keys over millisecond sums', () => {
  const url = 'https://example.com/overlay.html?hold=10000&fadeIn=600&seconds=3';
  const result = inferDurationFromQuery(url);
  assert.equal(result, 3);
});

test('inferDurationFromQuery sums millisecond-style params', () => {
  const url = 'https://example.com/overlay.html?hold=10000&fadeIn=600&fadeOut=600';
  const result = inferDurationFromQuery(url);
  assert.equal(result, 11.2);
});

test('resolveRenderSeconds applies precedence and padding', () => {
  const seconds = resolveRenderSeconds({
    explicitSeconds: 4,
    pageSeconds: 6,
    querySeconds: 8,
    padSeconds: 0.25,
    defaultSeconds: 2
  });
  assert.equal(seconds, 4.25);
});

test('buildVirtualTimePolicyPayload omits budget for pause policy', () => {
  const payload = buildVirtualTimePolicyPayload({ policy: 'pause', budget: 16.6 });
  assert.equal(payload.policy, 'pause');
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'budget'), false);
});

test('buildVirtualTimePolicyPayload rounds budget for advancing policy', () => {
  const payload = buildVirtualTimePolicyPayload({
    policy: 'pauseIfNetworkFetchesPending',
    budget: 16.2
  });
  assert.equal(payload.policy, 'pauseIfNetworkFetchesPending');
  assert.equal(payload.budget, 17);
});

test('render loop applies deterministic frame seek to page and iframe targets', () => {
  const source = fs.readFileSync(path.resolve(__dirname, 'render.js'), 'utf8');
  assert.ok(source.includes('const targets = [window];'));
  assert.ok(source.includes('baseFrame.contentWindow'));
  assert.ok(source.includes('document?.getAnimations?.()'));
  assert.ok(source.includes('animation.currentTime = frameTimeMs'));
  assert.ok(source.includes("typeof target.__setTimeMs === 'function'"));
  assert.equal(source.includes('waitForTimeout(frameIntervalMs)'), false);
});


test('master encoding preserves alpha with prores 4444', () => {
  const source = fs.readFileSync(path.resolve(__dirname, 'render.js'), 'utf8');
  assert.ok(source.includes('-c:v prores_ks -profile:v 4 -pix_fmt yuva444p10le'));
});

test('render init script marks capture mode for overlays', () => {
  const source = fs.readFileSync(path.resolve(__dirname, 'render.js'), 'utf8');
  assert.ok(source.includes('window.__RENDER_CAPTURE = true'));
});
