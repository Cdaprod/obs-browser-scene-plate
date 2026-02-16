/**
 * Tests for Program Monitor preview playback wiring.
 * Usage: node --test program-monitor/app-preview.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { resolveMediaDurationSeconds } from "./media-duration.js";

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
  assert.ok(source.includes("durationSeconds: getNodeDuration(index)"));
});



test("stage exports omit timeline and render plan payloads", () => {
  assert.ok(source.includes("stage_id: stageId || undefined"));
  assert.ok(source.includes("timeline: stageId ? undefined : timelinePayload"));
  assert.ok(source.includes("render_plan: stageId ? undefined : compileCurrentTimelinePlan()"));
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


test("project list storage supports migration and canonical index diagnostics", () => {
  assert.ok(source.includes("program-monitor.projects.v1"));
  assert.ok(source.includes("program-monitor.projects.migrated.v1"));
  assert.ok(source.includes("program-monitor.projects.deleted.v1"));
  assert.ok(source.includes('localStorage.getItem("program-monitor.pr")'));
  assert.ok(source.includes("markProjectDeleted"));
  assert.ok(source.includes("function supportsProjectApi()"));
  assert.ok(source.includes("function resolveProjectIndexUrl()"));
  assert.ok(source.includes('new URL("projects/_index.json", baseUrl).toString()'));
  assert.ok(source.includes('setProjectsStatus(`Loading index: ${indexUrl}`)'));
  assert.ok(source.includes("if (res.status === 404)"));
  assert.ok(source.includes('setProjectsStatus(`Index missing (404): ${finalUrl} (using local projects)`);'));
  assert.ok(source.includes('setProjectsStatus(`Index OK: ${finalUrl} (${staticProjects.length} projects)${tinyWarn}`);'));
  assert.ok(source.includes("revivedProjectIds"));
});


test("saving loaded project reuses active project id when names match", () => {
  assert.ok(source.includes("const cacheEntry = projectEntriesCache.find"));
  assert.ok(source.includes("currentProjectId"));
  assert.ok(source.includes("(cacheEntry?.name || \"\") === name"));
  assert.ok(source.includes("const projectId = isExplicitEdit"));
  assert.ok(source.includes("? currentProjectId"));
});

test("projects panel includes index status row", () => {
  assert.ok(html.includes('id="projectsStatus"'));
});


test("default projects index seed exists", () => {
  const indexPath = path.resolve("program-monitor", "projects", "_index.json");
  const raw = fs.readFileSync(indexPath, "utf8");
  const parsed = JSON.parse(raw);
  assert.ok(Array.isArray(parsed));
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

test("api calls use same-origin /api paths", () => {
  assert.ok(source.includes('function apiUrl(path)'));
  assert.ok(source.includes("fetchApiJson('/api/projects'"));
  assert.ok(source.includes("apiUrl('/api/exports')"));
  assert.ok(!source.includes('http://${host}:${renderApiPort}/api/projects'));
});


test("topic dial style spin params contribute duration hints", () => {
  const utilsPath = path.resolve("program-monitor", "timeline-utils.js");
  const utilsSource = fs.readFileSync(utilsPath, "utf8");
  assert.ok(utilsSource.includes("\"spin\""));
  assert.ok(utilsSource.includes("\"intro\""));
});

test("resume path clears paused base clock before async priming", () => {
  assert.ok(source.includes("if (resume)"));
  assert.ok(source.includes("state.basePausedAt = 0;"));
});


test("media duration resolver reports loading/unbounded/ready states", () => {
  const video = { duration: Number.NaN };
  assert.deepEqual(resolveMediaDurationSeconds(video), { state: "loading", seconds: 0 });

  video.duration = Number.POSITIVE_INFINITY;
  assert.deepEqual(resolveMediaDurationSeconds(video), { state: "unbounded", seconds: Number.POSITIVE_INFINITY });

  video.duration = 70.75;
  assert.deepEqual(resolveMediaDurationSeconds(video), { state: "ready", seconds: 70.75 });
});

test("preview media duration path handles loading/live and listener cleanup", () => {
  assert.ok(source.includes('setMessage("loading duration…")'));
  assert.ok(source.includes('setMessage("Live stream duration is unbounded.")'));
  assert.ok(source.includes('function clearDurationListeners()'));
  assert.ok(source.includes('function clearBaseHandlers()'));
});


test("all-nodes scrubber uses timeline model and timeline seek mapping", () => {
  assert.ok(source.includes("buildAllNodesTimelineModel"));
  assert.ok(source.includes("mapTimelineTToNode"));
  assert.ok(source.includes("isMediaDurationClock() && !isAllNodesMode()"));
  assert.ok(source.includes("style.flexGrow = String(duration)"));
});


test("recent exports surface queued/rendering/failed statuses", () => {
  assert.ok(source.includes("upsertPendingExport"));
  assert.ok(source.includes('status: "queued"'));
  assert.ok(source.includes('status: "rendering"'));
  assert.ok(source.includes('status: "failed"'));
  assert.ok(source.includes('pending://'));
});

test("projects index loader warns on tiny _index.json payloads", () => {
  assert.ok(source.includes("suspiciously small index payload"));
  assert.ok(source.includes("tiny payload"));
});
