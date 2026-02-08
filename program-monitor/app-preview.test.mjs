/**
 * Tests for Program Monitor preview playback wiring.
 * Usage: node --test program-monitor/app-preview.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const filePath = path.resolve("program-monitor", "app.js");
const source = fs.readFileSync(filePath, "utf8");
const htmlPath = path.resolve("program-monitor", "index.html");
const html = fs.readFileSync(htmlPath, "utf8");

test("preview playback includes overlay sync helpers", () => {
  assert.ok(source.includes("syncOverlayPlayback"));
  assert.ok(source.includes("basePausedAt"));
});

test("preview includes scrubber markup", () => {
  assert.ok(html.includes("previewScrubber"));
  assert.ok(html.includes("previewScrubberSegments"));
});

test("stage includes export timeline and recent exports controls", () => {
  assert.ok(html.includes("btnExportTimelineStage"));
  assert.ok(html.includes("recentMenu"));
  assert.ok(html.includes("exportModal"));
});
