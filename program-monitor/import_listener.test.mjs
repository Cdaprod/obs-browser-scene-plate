/**
 * Tests for Program Monitor import listener helpers.
 * Usage: node --test program-monitor/import_listener.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { normalizeImportNodes } = require("./import_listener.js");

process.on("uncaughtException", (error) => {
  console.error(error);
  process.exitCode = 1;
});

process.on("unhandledRejection", (error) => {
  console.error(error);
  process.exitCode = 1;
});

test("normalizeImportNodes drops empty entries and trims lines", () => {
  const input = [
    { lines: ["  http://example.com/base.mp4  ", ""] },
    { lines: [] },
    { lines: ["   "] },
    null
  ];

  const output = normalizeImportNodes(input);
  assert.deepEqual(output, [
    { lines: ["http://example.com/base.mp4"], durationOverride: "auto" }
  ]);
});

test("normalizeImportNodes preserves duration overrides", () => {
  const input = [
    { lines: ["http://example.com/base.mp4"], durationOverride: 3.2 },
    { lines: ["http://example.com/base2.mp4"], durationOverride: "auto" }
  ];

  const output = normalizeImportNodes(input);
  assert.deepEqual(output, [
    { lines: ["http://example.com/base.mp4"], durationOverride: 3.2 },
    { lines: ["http://example.com/base2.mp4"], durationOverride: "auto" }
  ]);
});
