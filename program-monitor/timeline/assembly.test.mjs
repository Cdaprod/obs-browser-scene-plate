/**
 * Tests for Program Monitor timeline assembly helpers.
 * Usage: node --test program-monitor/timeline/assembly.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAssembledClips, clipsToImportNodes, buildAssemblySpec } from './assembly.js';

test('buildAssembledClips sequence mode sorts by creation_time and appends', () => {
  const clips = buildAssembledClips({
    items: [
      { asset_id: `sha256:${'b'.repeat(64)}`, creation_time: '2026-01-01T00:00:10.000Z', duration: 2 },
      { asset_id: `sha256:${'a'.repeat(64)}`, creation_time: '2026-01-01T00:00:05.000Z', duration: 3 }
    ]
  }, { mode: 'sequence' });

  assert.equal(clips.length, 2);
  assert.equal(clips[0].start, 0);
  assert.equal(clips[1].start, 3);
  assert.equal(clips[0].ref.asset_id, `sha256:${'a'.repeat(64)}`);
});

test('buildAssembledClips multicam mode aligns tracks by origin and anchor time', () => {
  const clips = buildAssembledClips({
    items: [
      { asset_id: `sha256:${'a'.repeat(64)}`, origin: 'obs', creation_time: '2026-01-01T00:00:10.000Z' },
      { asset_id: `sha256:${'b'.repeat(64)}`, origin: 'iphone', creation_time: '2026-01-01T00:00:12.000Z' }
    ]
  }, { mode: 'multicam' });

  assert.equal(clips.length, 2);
  assert.equal(clips[0].start, 0);
  assert.equal(clips[1].start, 2);
  assert.notEqual(clips[0].track, clips[1].track);
});

test('clipsToImportNodes emits node lines with asset fallback format', () => {
  const nodes = clipsToImportNodes([
    { ref: { asset_id: `sha256:${'c'.repeat(64)}`, url: 'https://fallback.local/a.mp4' }, start: 0, duration: 5, track: 1 }
  ]);
  assert.equal(nodes.length, 1);
  assert.ok(nodes[0].text.includes('|https://fallback.local/a.mp4'));
});

test('buildAssemblySpec captures mode and count', () => {
  const spec = buildAssemblySpec({ asset_ids: [`sha256:${'d'.repeat(64)}`] }, { mode: 'multicam' });
  assert.equal(spec.mode, 'multicam');
  assert.equal(spec.item_count, 1);
});
