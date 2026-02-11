const test = require('node:test');
const assert = require('node:assert/strict');

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

