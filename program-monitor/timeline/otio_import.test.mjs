/**
 * Tests for Program Monitor OTIO importer.
 * Usage: node --test program-monitor/timeline/otio_import.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { importFromOtio, flattenOtioClips } from './otio_import.js';

test('flattenOtioClips maps timing, track, and registry asset identity', () => {
  const otio = {
    OTIO_SCHEMA: 'Timeline.1',
    tracks: {
      children: [
        {
          metadata: { role: 'base' },
          children: [
            {
              OTIO_SCHEMA: 'Clip.1',
              name: 'Base Clip',
              media_reference: { target_url: 'https://fallback.local/base.mp4' },
              source_range: {
                start_time: { value: 30, rate: 30 },
                duration: { value: 60, rate: 30 }
              },
              metadata: {
                'cdaprod.registry': {
                  asset_id: `sha256:${'a'.repeat(64)}`,
                  fallback_relative_path: 'ingest/base.mp4'
                }
              }
            }
          ]
        }
      ]
    }
  };

  const clips = flattenOtioClips(otio);
  assert.equal(clips.length, 1);
  assert.equal(clips[0].kind, 'video');
  assert.equal(clips[0].start, 0);
  assert.equal(clips[0].duration, 2);
  assert.equal(clips[0].in, 1);
  assert.equal(clips[0].ref.asset_id, `sha256:${'a'.repeat(64)}`);
});

test('importFromOtio returns backward-compatible nodes and clips', () => {
  const otio = {
    OTIO_SCHEMA: 'Timeline.1',
    tracks: {
      children: [
        {
          metadata: { role: 'base' },
          children: [
            {
              OTIO_SCHEMA: 'Clip.1',
              name: 'Base Clip',
              media_reference: { target_url: 'https://fallback.local/base.mp4' },
              source_range: {
                start_time: { value: 0, rate: 30 },
                duration: { value: 90, rate: 30 }
              },
              metadata: {}
            }
          ]
        },
        {
          metadata: { role: 'overlay' },
          children: [
            {
              OTIO_SCHEMA: 'Gap.1',
              source_range: {
                start_time: { value: 0, rate: 30 },
                duration: { value: 30, rate: 30 }
              }
            },
            {
              OTIO_SCHEMA: 'Clip.1',
              name: 'Overlay Clip',
              media_reference: { target_url: 'https://fallback.local/ov.html?dur=2' },
              source_range: {
                start_time: { value: 0, rate: 30 },
                duration: { value: 60, rate: 30 }
              },
              metadata: {}
            }
          ]
        }
      ]
    }
  };

  const imported = importFromOtio(otio);
  assert.equal(imported.nodes.length, 2);
  assert.ok(imported.nodes[0].text.includes('base.mp4'));
  assert.ok(imported.nodes[1].text.includes('ov.html'));
  assert.equal(imported.clips.length, 2);
});
