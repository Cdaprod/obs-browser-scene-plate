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

test('buildOtioTimeline maps base + overlay layering and preserves originalUrl metadata', () => {
  const renderPlan = {
    id: 'plan-1',
    fps: 60,
    nodes: [
      {
        id: 'n1',
        duration: 3,
        base: {
          url: 'https://example.com/base-a.mp4',
          metadata: { originalUrl: 'https://example.com/base-a.mp4' }
        },
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
              bakedPlatePath: '/renders/plates/base-b.mov'
            }
          },
          {
            role: 'overlay',
            url: 'https://example.com/ov-c.webm',
            metadata: {
              originalUrl: 'https://example.com/ov-c.webm',
              baked_plate_path: '/renders/plates/ov-c.mov'
            }
          }
        ]
      }
    ]
  };

  const otio = buildOtioTimeline(renderPlan, { name: 'Demo' });
  assert.equal(otio.OTIO_SCHEMA, 'Timeline.1');
  assert.equal(otio.name, 'Demo');
  assert.equal(otio.tracks.children.length, 3); // base + 2 overlay tracks

  const [baseTrack, overlay1, overlay2] = otio.tracks.children;
  assert.equal(baseTrack.children.length, 2);
  assert.equal(overlay1.children.length, 2);
  assert.equal(overlay2.children.length, 2);

  assert.equal(baseTrack.children[0].media_reference.target_url, 'https://example.com/base-a.mp4');
  assert.equal(baseTrack.children[1].media_reference.target_url, '/renders/plates/base-b.mov');
  assert.equal(baseTrack.children[1].metadata.originalUrl, 'https://example.com/base-b.mp4');

  assert.equal(overlay1.children[0].metadata.originalUrl, 'https://example.com/ov-a.webm');
  assert.equal(overlay1.children[1].media_reference.target_url, '/renders/plates/ov-c.mov');
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
