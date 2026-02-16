/**
 * Tests for Program Monitor timeline core module.
 * Usage: node --test program-monitor/timeline-core.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function loadTimelineCore() {
  const filePath = path.resolve("program-monitor", "timeline", "core.js");
  const source = await fs.readFile(filePath, "utf8");
  const exportNames = [...source.matchAll(/export function\s+(\w+)\s*\(/g)].map((m) => m[1]);
  const transformed = source.replace(/export function\s+/g, "function ");
  const factory = new Function(
    "URL",
    "URLSearchParams",
    "TextEncoder",
    "TextDecoder",
    "Buffer",
    `${transformed}\nreturn { ${exportNames.join(", ")} };`
  );
  return factory(URL, URLSearchParams, TextEncoder, TextDecoder, Buffer);
}

test("compileTimeline is deterministic for identical input", async () => {
  const core = await loadTimelineCore();
  const input = {
    timeline: {
      version: 1,
      nodes: [{ id: "n1", text: "http://host/base.html?hold=1200\nhttp://host/music.mp3", durationOverride: "" }],
      activeIndex: 0
    },
    fps: 60,
    width: 1080,
    height: 1920
  };
  const first = core.compileTimeline(input);
  const second = core.compileTimeline(input);
  assert.deepEqual(first, second);
  assert.equal(first.nodes[0].layers[0].role, "base");
  assert.equal(first.nodes[0].layers[1].role, "ambient");
  assert.equal(first.nodes[0].base.kind, "page");
  assert.equal(first.nodes[0].duration, 1.2);
});

test("all-nodes timeline model maps timeline and node-local time consistently", async () => {
  const core = await loadTimelineCore();
  const timeline = core.buildAllNodesTimelineModel([
    { id: "n1", duration: 2 },
    { id: "n2", duration: 3 },
    { id: "n3", duration: 5 }
  ]);

  assert.equal(timeline.ready, true);
  assert.equal(timeline.total, 10);
  assert.deepEqual(timeline.starts, [0, 2, 5]);

  const t = core.mapNodeToTimelineT(timeline, 1, 1.5);
  assert.equal(t, 3.5);

  const mapped = core.mapTimelineTToNode(timeline, 7);
  assert.equal(mapped.nodeIndex, 2);
  assert.equal(mapped.nodeLocalT, 2);
});
