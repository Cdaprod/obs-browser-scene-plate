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

test("exports include recent exports menu and modal markup", () => {
  assert.ok(html.includes("recentMenu"));
  assert.ok(html.includes("exportModal"));
  assert.ok(html.includes("exportModalDelivered"));
  assert.ok(html.includes("exportModalDeliver"));
  assert.ok(!html.includes("btnExportTimelineStage"));
  assert.ok(source.includes("setRecentMenuPolling"));
});

test("exports buttons are single-source-of-truth", () => {
  assert.equal((html.match(/btnExportTimeline/g) || []).length, 1);
  assert.equal((html.match(/btnExportNode/g) || []).length, 1);
  assert.ok(source.includes("bindUIOnce"));
});

test("exports validate durations for HTML nodes", () => {
  assert.ok(source.includes("validateExportDurations"));
  assert.ok(source.includes("applyDurationParamToNodeText"));
});

test("render clock helper is available", () => {
  const clockPath = path.resolve("site", "js", "render_clock_v1.js");
  const clockSource = fs.readFileSync(clockPath, "utf8");
  assert.ok(clockSource.includes("RenderClock"));
  assert.ok(clockSource.includes("__SET_RENDER_TIME"));
});

test("project persistence uses canonical api save/load flows", () => {
  assert.ok(source.includes("/api/projects:resolve"));
  assert.ok(source.includes("saveProjectState"));
  assert.ok(source.includes("fetchProjectState"));
  assert.ok(source.includes("applyTimelineToEditor"));
});

test("project drafts persist locally per selected project", () => {
  assert.ok(source.includes("programMonitor:draft:"));
  assert.ok(source.includes("saveProjectDraft"));
  assert.ok(source.includes("loadProjectDraft"));
});

test("stop and scrub preserve frame position", () => {
  assert.ok(source.includes("const timelineOffset = getTimelineOffset(state.activeIndex);"));
  assert.ok(source.includes("elements.baseVideo.currentTime = baseElapsed;"));
  assert.ok(source.includes("syncOverlayPlayback(baseElapsed, false);"));
});

test("html/image elapsed time uses live clock while playing", () => {
  assert.ok(source.includes("if (state.playing)"));
  assert.ok(source.includes("return (performance.now() - baseStartTime) / 1000;"));
  assert.ok(source.includes("state.basePausedAt = 0;"));
});
