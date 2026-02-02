/**
 * Tests for audio_input_waveform overlay docs.
 * Usage: node --test site/overlays/audio_input_waveform.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

process.on("uncaughtException", (error) => {
  console.error(error);
  process.exitCode = 1;
});

process.on("unhandledRejection", (error) => {
  console.error(error);
  process.exitCode = 1;
});

const source = fs.readFileSync(
  path.join(__dirname, "audio_input_waveform.html"),
  "utf8"
);

test("audio input waveform overlay documents default URL", () => {
  assert.match(source, /Default URL \(full params\):/);
  assert.match(
    source,
    /audio_input_waveform\.html\?ws=ws:\/\/127\.0\.0\.1:8765&mode=bars&bins=64&bar=124,248,255,0\.9&line=124,248,255,0\.9&bg=0,0,0,0&smooth=0\.25&decay=0\.92&peak=255,255,255,0\.9/
  );
});
