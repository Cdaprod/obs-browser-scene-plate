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
  assertRenderOriginSafe,
  parseProgramMonitorText,
  classifyProgramMonitorUrl,
  buildProgramMonitorFilename,
  buildProgramMonitorTimelineHash,
  assertHtmlDurationSeconds,
  createStageEntry,
  readStageEntry,
  writeStage,
  readStage,
  deleteStage,
  gcStages,
  pruneJobs,
  gcProgramMonitorCache,
  atomicWriteJson,
  projectTimelinePath,
  projectStatePath,
  readJsonSafe,
  readProjectState,
  readProjectIndex,
  resolveProjectByName,
  saveProjectState,
  listProjectExports,
  buildRangeResponse,
  resolveExportFilePath,
  deliverExportArtifacts,
  resolveDeliveryDir,
  buildDebugFramePath,
  buildProgramMonitorHtml
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
  const result = normalizeRenderUrl(url, { renderOrigin: 'http://obs-plate' });
  assert.equal(result, 'http://obs-plate/overlays/title.html?mode=burst#hash');
});

test('normalizeRenderUrl accepts relative paths', () => {
  const result = normalizeRenderUrl('/overlays/title.html?mode=burst', {
    renderOrigin: 'http://obs-plate'
  });
  assert.equal(result, 'http://obs-plate/overlays/title.html?mode=burst');
});

test('normalizeRenderUrl rewrites public origin to render origin', () => {
  const result = normalizeRenderUrl('http://192.168.0.25:8789/overlays/demo.html', {
    renderOrigin: 'http://obs-plate',
    publicOrigin: 'http://192.168.0.25:8789'
  });
  assert.equal(result, 'http://obs-plate/overlays/demo.html');
});

test('normalizeRenderUrl rewrites 192.168.0.25:8789 even without public origin', () => {
  const result = normalizeRenderUrl('http://192.168.0.25:8789/overlays/demo.html', {
    renderOrigin: 'http://obs-plate'
  });
  assert.equal(result, 'http://obs-plate/overlays/demo.html');
});

test('assertRenderOriginSafe throws when rewrite leaves unsafe origins', () => {
  assert.throws(() => {
    assertRenderOriginSafe({
      urls: ['http://192.168.0.25:8789/overlays/demo.html'],
      context: 'test'
    });
  });
  assert.throws(() => {
    assertRenderOriginSafe({
      urls: ['http://obs-plate:8789/overlays/demo.html'],
      context: 'test'
    });
  });
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

test('buildProgramMonitorTimelineHash includes node duration metadata', () => {
  const withDuration = buildProgramMonitorTimelineHash({
    nodes: [{ text: 'http://obs-plate/overlays/demo.html', durationSeconds: 13 }]
  }, { fps: 60, width: 1080, height: 1920 });

  const withoutDuration = buildProgramMonitorTimelineHash({
    nodes: [{ text: 'http://obs-plate/overlays/demo.html' }]
  }, { fps: 60, width: 1080, height: 1920 });

  assert.notEqual(withDuration, withoutDuration);
});

test('buildProgramMonitorHtml uses iframe for HTML overlays', () => {
  const html = buildProgramMonitorHtml({
    baseUrl: 'http://obs-plate/overlays/demo.html',
    layers: []
  });
  assert.ok(html.includes('<iframe id="base"'));
  assert.ok(html.includes('window.__RENDER_READY'));
});

test('assertHtmlDurationSeconds rejects missing HTML durations', () => {
  assert.throws(() => {
    assertHtmlDurationSeconds({ url: 'http://obs-plate/overlays/demo.html', durationSeconds: null });
  });
  assert.doesNotThrow(() => {
    assertHtmlDurationSeconds({ url: 'http://obs-plate/overlays/demo.html', durationSeconds: 4.25 });
  });
});

test('buildDebugFramePath targets the delivery directory', () => {
  const debugPath = buildDebugFramePath({
    projectId: 'demo',
    jobId: 'job-123',
    rendersDir: '/renders',
    subdir: '_exports'
  });
  assert.equal(debugPath, path.join('/renders', '_exports', 'demo', 'exports', 'job-123', 'debug_first_frame.png'));
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

test('buildRangeResponse returns 206 with correct headers', () => {
  const response = buildRangeResponse({
    rangeHeader: 'bytes=0-1023',
    size: 2048,
    contentType: 'video/quicktime'
  });
  assert.equal(response.statusCode, 206);
  assert.equal(response.headers['Content-Range'], 'bytes 0-1023/2048');
  assert.equal(response.headers['Accept-Ranges'], 'bytes');
  assert.equal(response.headers['Content-Length'], 1024);
});

test('resolveExportFilePath blocks traversal and allows valid paths', () => {
  const baseDir = path.join(os.tmpdir(), 'exports-safe');
  const safePath = resolveExportFilePath({
    projectId: 'demo',
    jobId: 'job-1',
    filename: 'render.mov',
    baseDir
  });
  assert.ok(safePath);
  assert.ok(safePath.includes(path.join('demo', 'exports', 'job-1', 'render.mov')));

  const traversal = resolveExportFilePath({
    projectId: 'demo',
    jobId: 'job-1',
    filename: '../secrets.txt',
    baseDir
  });
  assert.equal(traversal, null);
});

test('deliverExportArtifacts copies artifacts into renders directory', async () => {
  const tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-'));
  const tempRenders = fs.mkdtempSync(path.join(os.tmpdir(), 'renders-'));
  try {
    const projectId = 'demo';
    const jobId = 'job-1';
    const jobDir = path.join(tempWorkspace, 'projects', projectId, 'exports', jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'render.mov'), 'mov');
    fs.writeFileSync(path.join(jobDir, 'render.log'), 'log');
    fs.writeFileSync(path.join(jobDir, 'manifest.json'), JSON.stringify({ job_id: jobId }));

    const result = await deliverExportArtifacts({
      projectId,
      jobId,
      jobDir,
      filename: 'render.mov',
      rendersDir: tempRenders,
      subdir: '_exports'
    });
    assert.equal(result.delivered, true);
    const deliveryDir = resolveDeliveryDir({ projectId, jobId, rendersDir: tempRenders, subdir: '_exports' });
    assert.ok(fs.existsSync(path.join(deliveryDir, 'render.mov')));
    assert.ok(fs.existsSync(path.join(deliveryDir, 'render.log')));
    assert.ok(fs.existsSync(path.join(deliveryDir, 'manifest.json')));
  } finally {
    fs.rmSync(tempWorkspace, { recursive: true, force: true });
    fs.rmSync(tempRenders, { recursive: true, force: true });
  }
});


test('resolveProjectByName returns stable ids for case-insensitive names', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'projects-resolve-'));
  try {
    const first = resolveProjectByName('Typewriter-1', { baseDir: tempDir });
    const second = resolveProjectByName('  typewriter-1  ', { baseDir: tempDir });
    assert.equal(first.project_id, second.project_id);
    const index = readProjectIndex({ baseDir: tempDir });
    assert.equal(index.length, 1);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('saveProjectState persists nodesStructured and can be re-read', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'projects-state-'));
  try {
    const projectId = 'typewriter-1';
    const saved = saveProjectState({
      projectId,
      name: 'Typewriter-1',
      payload: {
        timeline: {
          version: 1,
          activeIndex: 0,
          nodes: [{ id: 'n1', text: 'http://example.com/a.html', durationOverride: '' }],
          nodesStructured: [{
            id: 'n1',
            text: 'http://example.com/a.html',
            durationOverride: '',
            base: { url: 'http://example.com/a.html', kind: 'page' },
            overlays: [],
            ambient: []
          }]
        }
      },
      baseDir: tempDir
    });

    assert.equal(saved.project_id, projectId);
    const file = projectStatePath(projectId, { baseDir: tempDir });
    const loaded = readProjectState(projectId, { baseDir: tempDir });
    assert.ok(fs.existsSync(file));
    assert.equal(loaded.payload.timeline.nodesStructured.length, 1);
    assert.equal(loaded.payload.timeline.nodesStructured[0].base.kind, 'page');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('pruneJobs removes old completed jobs and preserves active jobs', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-jobs-'));
  try {
    const jobsMap = new Map([
      ['ready-old', { id: 'ready-old', state: 'ready', updatedAt: '2024-01-01T00:00:00.000Z' }],
      ['error-new', { id: 'error-new', state: 'error', updatedAt: '2024-01-02T00:00:00.000Z' }],
      ['rendering', { id: 'rendering', state: 'rendering', updatedAt: '2024-01-01T00:00:00.000Z' }]
    ]);
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'ready-old.json'), '{}');

    pruneJobs({
      now: Date.parse('2024-01-03T00:00:00.000Z'),
      retentionMs: 24 * 60 * 60 * 1000,
      memoryLimit: 20,
      jobsMap,
      jobsDir: tempDir
    });

    assert.equal(jobsMap.has('ready-old'), false);
    assert.equal(jobsMap.has('error-new'), false);
    assert.equal(jobsMap.has('rendering'), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('gcProgramMonitorCache prunes stale tmp and caps cached renders', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-cache-'));
  try {
    const tmpDir = path.join(tempRoot, 'tmp');
    const nodeDir = path.join(tempRoot, 'nodes');
    const timelineDir = path.join(tempRoot, 'timelines');
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.mkdirSync(nodeDir, { recursive: true });
    fs.mkdirSync(timelineDir, { recursive: true });

    const staleTmp = path.join(tmpDir, 'old.html');
    const freshTmp = path.join(tmpDir, 'new.html');
    fs.writeFileSync(staleTmp, 'old');
    fs.writeFileSync(freshTmp, 'new');
    fs.utimesSync(staleTmp, new Date('2024-01-01T00:00:00.000Z'), new Date('2024-01-01T00:00:00.000Z'));
    fs.utimesSync(freshTmp, new Date('2024-01-03T00:00:00.000Z'), new Date('2024-01-03T00:00:00.000Z'));

    ['a.mov', 'b.mov', 'c.mov'].forEach((name, index) => {
      const file = path.join(nodeDir, name);
      fs.writeFileSync(file, name);
      const d = new Date(Date.parse('2024-01-03T00:00:00.000Z') - (index * 1000));
      fs.utimesSync(file, d, d);
    });

    gcProgramMonitorCache({
      now: Date.parse('2024-01-03T00:00:20.000Z'),
      tmpDir,
      nodeDir,
      timelineDir,
      tmpTtlMs: 30 * 1000,
      cacheTtlMs: 10 * 60 * 1000,
      cacheMaxFiles: 2
    });

    assert.equal(fs.existsSync(staleTmp), false);
    assert.equal(fs.existsSync(freshTmp), true);
    assert.equal(fs.readdirSync(nodeDir).length, 2);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

