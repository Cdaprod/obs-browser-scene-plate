/**
 * Tests for OTIO RenderPlan exporter.
 * Usage: node --test program-monitor/timeline/otio_export.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { buildOtioTimeline, exportToOtio } = require('./otio_export.js');

test('buildOtioTimeline maps base + overlay layering and preserves source metadata', () => {
  const renderPlan = {
    id: 'plan-1',
    fps: 60,
    nodes: [
      {
        id: 'n1',
        duration: 3,
        layers: [
          { role: 'base', url: 'https://example.com/base-a.mp4', metadata: { originalUrl: 'https://example.com/base-a.mp4' } },
          { role: 'overlay', url: 'https://example.com/ov-a.webm', metadata: { originalUrl: 'https://example.com/ov-a.webm' } },
          { role: 'overlay', url: 'https://example.com/ov-b.webm', metadata: { originalUrl: 'https://example.com/ov-b.webm' } }
        ]
      },
      {
        id: 'n2',
        duration_seconds: 2,
        layers: [
          {
            role: 'base',
            url: 'https://example.com/base-b.mp4',
            metadata: {
              originalUrl: 'https://example.com/base-b.mp4',
              platePath: '/renders/plates/base-b.mov'
            }
          },
          {
            role: 'overlay',
            url: 'https://example.com/ov-c.webm',
            metadata: {
              originalUrl: 'https://example.com/ov-c.webm',
              bakedPath: '/renders/plates/ov-c.mov'
            }
          }
        ]
      }
    ]
  };

  const otio = buildOtioTimeline(renderPlan, { name: 'Demo' });
  assert.equal(otio.OTIO_SCHEMA, 'Timeline.1');
  assert.equal(otio.name, 'Demo');
  assert.equal(otio.tracks.children.length, 3);

  const [baseTrack, overlay1, overlay2] = otio.tracks.children;
  assert.equal(baseTrack.name, 'Base');
  assert.equal(overlay1.name, 'Overlay 1');
  assert.equal(overlay2.name, 'Overlay 2');

  assert.equal(baseTrack.children[1].media_reference.target_url, '/renders/plates/base-b.mov');
  assert.equal(baseTrack.children[1].metadata.source.type, 'plate');
  assert.equal(overlay1.children[1].media_reference.target_url, '/renders/plates/ov-c.mov');
  assert.equal(overlay1.children[1].metadata.source.type, 'plate');
  assert.equal(overlay2.children[1].OTIO_SCHEMA, 'Gap.1');
});

test('exportToOtio writes a valid json timeline file and returns resolved path', () => {
  const renderPlan = {
    fps: 24,
    nodes: [
      {
        id: 'node-a',
        duration: 1.5,
        layers: [
          { role: 'base', url: 'https://example.com/base.mp4', metadata: { originalUrl: 'https://example.com/base.mp4' } }
        ]
      }
    ]
  };

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'otio-export-'));
  const outputPath = path.join(tmpDir, 'timeline.otio');

  const resolvedPath = exportToOtio(renderPlan, { outputPath, name: 'Single' });
  assert.equal(resolvedPath, path.resolve(outputPath));
  const written = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
  assert.equal(written.OTIO_SCHEMA, 'Timeline.1');
  assert.equal(written.global_start_time.rate, 24);
  assert.equal(written.tracks.children[0].children[0].source_range.duration.value, 36);
});

test('plate path key precedence supports platePath, bakedPath, and plate_path', () => {
  const renderPlan = {
    nodes: [
      {
        id: 'n1',
        duration: 1,
        layers: [{ role: 'base', url: 'https://example.com/base-a.mp4', metadata: { originalUrl: 'https://example.com/base-a.mp4', plate_path: '/a/plate-path.mov', bakedPath: '/a/baked-path.mov', platePath: '/a/platePath.mov' } }]
      }
    ]
  };
  const otio = buildOtioTimeline(renderPlan);
  const clip = otio.tracks.children[0].children[0];
  assert.equal(clip.media_reference.target_url, '/a/platePath.mov');
  assert.equal(clip.metadata.source.type, 'plate');
});

test('zero and negative duration nodes are skipped cleanly', () => {
  const renderPlan = {
    nodes: [
      { id: 'n1', duration: -2, layers: [{ role: 'base', url: 'https://example.com/base1.mp4' }] },
      { id: 'n2', duration: 0, layers: [{ role: 'base', url: 'https://example.com/base2.mp4' }] },
      { id: 'n3', duration: 2, layers: [{ role: 'base', url: 'https://example.com/base3.mp4' }] }
    ]
  };
  const otio = buildOtioTimeline(renderPlan);
  assert.equal(otio.tracks.children[0].children.length, 1);
  assert.equal(otio.tracks.children[0].children[0].name, 'Base n3');
});


test('duration resolver falls through invalid early fields to later positive durations', () => {
  const renderPlan = {
    fps: 30,
    nodes: [
      {
        id: 'n1',
        duration: '',
        duration_seconds: 0,
        resolved_duration_sec: '2.5',
        layers: [
          { role: 'base', url: 'https://example.com/base.mp4', metadata: { originalUrl: 'https://example.com/base.mp4' } }
        ]
      }
    ]
  };

  const otio = buildOtioTimeline(renderPlan);
  const clip = otio.tracks.children[0].children[0];
  assert.equal(clip.OTIO_SCHEMA, 'Clip.1');
  assert.equal(clip.source_range.duration.value, 75);
});


test('buildOtioTimeline stores cdaprod registry metadata when asset identity exists', () => {
  const sha = 'e'.repeat(64);
  const renderPlan = {
    nodes: [
      {
        id: 'n-registry',
        duration: 2,
        layers: [
          {
            role: 'base',
            url: 'https://example.com/base.mp4',
            metadata: {
              originalUrl: 'https://example.com/base.mp4',
              asset_id: `sha256:${sha}`,
              canonical_name: 'P1_obs_20260117_185714_eeeeeeee.mp4',
              origin: 'obs',
              orientation: { rotation: 0, normalized: true }
            }
          }
        ]
      }
    ]
  };

  const otio = buildOtioTimeline(renderPlan);
  const clip = otio.tracks.children[0].children[0];
  assert.equal(clip.metadata['cdaprod.registry'].asset_id, `sha256:${sha}`);
  assert.equal(clip.metadata['cdaprod.registry'].sha256, sha);
  assert.equal(clip.metadata['cdaprod.registry'].origin, 'obs');
});


test('buildOtioTimeline exports explicit clip/track model when clips are provided', () => {
  const renderPlan = {
    fps: 30,
    clips: [
      {
        id: 'clip-base',
        kind: 'video',
        ref: { asset_id: `sha256:${'f'.repeat(64)}`, url: 'https://fallback.local/base.mp4' },
        start: 0,
        duration: 2,
        in: 1,
        track: 0,
        metadata: { 'cdaprod.registry': { asset_id: `sha256:${'f'.repeat(64)}` } }
      },
      {
        id: 'clip-overlay',
        kind: 'overlay_html',
        ref: { url: 'https://fallback.local/overlay.html?dur=2' },
        start: 1,
        duration: 1,
        in: 0,
        track: 10
      }
    ]
  };

  const otio = buildOtioTimeline(renderPlan);
  assert.equal(otio.tracks.children.length, 2);
  assert.equal(otio.tracks.children[0].children[0].source_range.start_time.value, 30);
  assert.equal(otio.tracks.children[0].children[0].metadata['cdaprod.registry'].asset_id, `sha256:${'f'.repeat(64)}`);
});
