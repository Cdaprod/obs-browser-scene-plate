/**
 * Tests for the staged preview markup.
 * Usage: node --test program-monitor/staged-preview.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const filePath = path.resolve("program-monitor", "staged-preview.html");
const html = fs.readFileSync(filePath, "utf8");

test("staged preview includes NLE timeline scaffold", () => {
  assert.ok(html.includes("NLE Timeline Stage Preview"));
  assert.ok(html.includes("timelineTrack"));
  assert.ok(html.includes("scrubberSegments"));
  assert.ok(html.includes("nodeContainer"));
});

test("staged preview reports missing stage id", () => {
  assert.ok(html.includes("Missing stage id."));
});

test("staged preview fetches stage payloads by id", () => {
  assert.ok(html.includes("/api/program-monitor/stage/"));
});
