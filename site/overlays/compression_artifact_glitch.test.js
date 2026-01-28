/**
 * Tests for compression_artifact_glitch overlay docs.
 * Usage: node --test site/overlays/compression_artifact_glitch.test.js
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
  path.join(__dirname, "compression_artifact_glitch.html"),
  "utf8"
);

test("compression artifact glitch overlay documents default URL", () => {
  assert.match(source, /Default URL \(full params\):/);
  assert.match(
    source,
    /compression_artifact_glitch\.html\?alpha=0\.32&block=24&smear=0\.6&burst=0\.35&fps=24&cool=0\.12&loop=6/
  );
});
