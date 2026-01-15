const test = require('node:test');
const assert = require('node:assert/strict');

const { safeName, buildFilename } = require('./server');

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
