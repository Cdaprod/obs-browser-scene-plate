const test = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { safeName, buildFilename, listRenderFiles } = require('./server');

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
