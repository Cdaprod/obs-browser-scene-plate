const test = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  safeName,
  buildFilename,
  listRenderFiles,
  normalizeRenderUrl,
  parseProgramMonitorText,
  classifyProgramMonitorUrl,
  buildProgramMonitorFilename,
  createStageEntry,
  readStageEntry,
  writeStage,
  readStage,
  deleteStage,
  gcStages,
  atomicWriteJson,
  projectTimelinePath,
  readJsonSafe,
  listProjectExports
} = require('./server');

test('safeName sanitizes unsafe characters and trims length', () => {
  const input = 'Hello/World?* With Spaces!!!';
  const output = safeName(input);
  assert.equal(output, 'Hello_World_With_Spaces_');
  assert.ok(output.length <= 120);
});

test('buildFilename formats a deterministic render filename', () => {
  const now = new Date('2024-01-02T03:04:05.678Z');
  const filename = buildFilename({
    name: 'My Plate',
    width: 1080,
    height: 1920,
    fps: 60,
    seconds: 4,
    now
  });

  assert.equal(
    filename,
    'My_Plate_1080x1920_60fps_4000ms_2024-01-02T03-04-05-678Z.mov'
  );
});

test('buildFilename uses auto when seconds are omitted', () => {
  const now = new Date('2024-01-02T03:04:05.678Z');
  const filename = buildFilename({
    name: 'My Plate',
    width: 1080,
    height: 1920,
    fps: 60,
    seconds: null,
    now
  });

  assert.equal(
    filename,
    'My_Plate_1080x1920_60fps_auto_2024-01-02T03-04-05-678Z.mov'
  );
});

test('listRenderFiles returns renders sorted by newest first', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'renders-'));
  try {
    const older = path.join(tempDir, 'older.mov');
    const newer = path.join(tempDir, 'newer.mov');
    const ignored = path.join(tempDir, 'ignore.txt');

    fs.writeFileSync(older, 'a');
    fs.writeFileSync(newer, 'b');
    fs.writeFileSync(ignored, 'c');

    fs.utimesSync(older, new Date('2024-01-01T00:00:00Z'), new Date('2024-01-01T00:00:00Z'));
    fs.utimesSync(newer, new Date('2024-02-01T00:00:00Z'), new Date('2024-02-01T00:00:00Z'));

    const entries = listRenderFiles({ dir: tempDir, limit: 5 });

    assert.equal(entries.length, 2);
    assert.equal(entries[0].filename, 'newer.mov');
    assert.equal(entries[1].filename, 'older.mov');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('normalizeRenderUrl rewrites localhost to the render origin', () => {
  const url = 'http://localhost:8789/overlays/title.html?mode=burst#hash';
  const result = normalizeRenderUrl(url, { renderOrigin: 'http://obs_plate' });
  assert.equal(result, 'http://obs_plate/overlays/title.html?mode=burst#hash');
});

test('normalizeRenderUrl accepts relative paths', () => {
  const result = normalizeRenderUrl('/overlays/title.html?mode=burst', {
    renderOrigin: 'http://obs_plate'
  });
  assert.equal(result, 'http://obs_plate/overlays/title.html?mode=burst');
});

test('parseProgramMonitorText splits base and layers', () => {
  const text = [
    'http://example.com/base.mp4',
    '# ignore',
    'http://example.com/overlay.webm'
  ].join('\n');

  const parsed = parseProgramMonitorText(text);
  assert.equal(parsed.baseUrl, 'http://example.com/base.mp4');
  assert.deepEqual(parsed.layers, ['http://example.com/overlay.webm']);
});

test('classifyProgramMonitorUrl detects audio, image, and video', () => {
  assert.equal(classifyProgramMonitorUrl('http://example.com/track.mp3'), 'audio');
  assert.equal(classifyProgramMonitorUrl('http://example.com/frame.png'), 'image');
  assert.equal(classifyProgramMonitorUrl('http://example.com/clip.mp4'), 'video');
});

test('buildProgramMonitorFilename is deterministic', () => {
  const filename = buildProgramMonitorFilename({
    prefix: 'program-monitor-node',
    hash: 'abc123',
    width: 1080,
    height: 1920,
    fps: 60,
    seconds: null
  });
  assert.equal(filename, 'program-monitor-node_1080x1920_60fps_auto_abc123.mov');
});

test('stage cache stores and reads entries on disk', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-cache-'));
  try {
    const entry = createStageEntry({
      dir: tempDir,
      ttlSeconds: 120,
      payload: {
        timeline: { version: 1, nodes: [{ text: 'http://example.com/base.mp4' }] },
        name: 'Test Stage',
        createdBy: 'test'
      }
    });

    const stored = readStageEntry({ stageId: entry.id, dir: tempDir });
    assert.ok(stored);
    assert.equal(stored.payload.name, 'Test Stage');
    assert.equal(stored.payload.timeline.nodes.length, 1);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('gcStages deletes expired entries', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-cache-expire-'));
  try {
    const entry = createStageEntry({
      dir: tempDir,
      ttlSeconds: 1,
      payload: { timeline: { version: 1, nodes: [{ text: 'http://example.com/base.mp4' }] } }
    });

    gcStages({ dir: tempDir, now: Date.now() + 5000 });
    const stored = readStageEntry({ stageId: entry.id, dir: tempDir });
    assert.equal(stored, null);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('stage cache survives restart via disk read', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-cache-restart-'));
  try {
    const stageId = 'stage-restart';
    writeStage({
      dir: tempDir,
      stageId,
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      payload: { timeline: { version: 1, nodes: [{ text: 'http://example.com/base.mp4' }] } }
    });
    const stored = readStage({ stageId, dir: tempDir });
    assert.ok(stored);
    deleteStage({ stageId, dir: tempDir });
    const deleted = readStage({ stageId, dir: tempDir });
    assert.equal(deleted, null);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('project timeline writes and reads from disk', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'projects-'));
  try {
    const projectId = 'demo-project';
    const timelinePath = projectTimelinePath(projectId, { baseDir: tempDir });
    const timeline = { version: 1, nodes: [{ text: 'http://example.com/base.mp4' }], activeIndex: 0 };
    atomicWriteJson(timelinePath, timeline);

    const loaded = readJsonSafe(timelinePath, null);
    assert.deepEqual(loaded, timeline);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('listProjectExports returns manifests in newest order', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'exports-'));
  try {
    const projectId = 'demo-project';
    const exportDir = path.join(tempDir, projectId, 'exports', 'job-1');
    fs.mkdirSync(exportDir, { recursive: true });
    const manifestPath = path.join(exportDir, 'manifest.json');
    const manifest = {
      job_id: 'job-1',
      filename: 'render.mov',
      created_at: new Date('2024-02-01T00:00:00Z').toISOString(),
      size_bytes: 10,
      download_url: '/exports/demo-project/job-1/render.mov',
      manifest_url: '/exports/demo-project/job-1/manifest.json',
      log_url: '/exports/demo-project/job-1/render.log'
    };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    const exportsList = listProjectExports(projectId, { baseDir: tempDir });
    assert.equal(exportsList.length, 1);
    assert.equal(exportsList[0].job_id, 'job-1');
    assert.equal(exportsList[0].manifest_url, '/exports/demo-project/job-1/manifest.json');
    assert.equal(exportsList[0].log_url, '/exports/demo-project/job-1/render.log');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
