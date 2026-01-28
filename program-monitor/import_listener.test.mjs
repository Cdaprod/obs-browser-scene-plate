/**
 * Tests for Program Monitor import listener helpers.
 * Usage: node --test program-monitor/import_listener.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  normalizeImportNodes,
  buildImportPlan,
  shouldApplyDurationOverride,
  recordMessageId,
  wasMessageProcessed
} = require("./import_listener.js");

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

test("buildImportPlan fills empty nodes before append", () => {
  const nodeTexts = ["", "filled", ""];
  const plan = buildImportPlan(nodeTexts, 2);
  assert.deepEqual(plan, { existingIndexes: [0, 2], appendCount: 0 });
});

test("buildImportPlan appends when empties are exhausted", () => {
  const nodeTexts = ["", "filled", ""];
  const plan = buildImportPlan(nodeTexts, 4);
  assert.deepEqual(plan, { existingIndexes: [0, 2], appendCount: 2 });
});

test("shouldApplyDurationOverride skips auto and empty values", () => {
  assert.equal(shouldApplyDurationOverride(undefined), false);
  assert.equal(shouldApplyDurationOverride(null), false);
  assert.equal(shouldApplyDurationOverride(""), false);
  assert.equal(shouldApplyDurationOverride("auto"), false);
  assert.equal(shouldApplyDurationOverride(0), true);
  assert.equal(shouldApplyDurationOverride(2.5), true);
  assert.equal(shouldApplyDurationOverride("3"), true);
});

test("messageId de-dupe only records once", () => {
  const messageId = "msg-123";
  assert.equal(wasMessageProcessed(messageId), false);
  assert.equal(recordMessageId(messageId), true);
  assert.equal(wasMessageProcessed(messageId), true);
  assert.equal(recordMessageId(messageId), false);
});

test("messageId de-dupe allows different ids", () => {
  const first = "msg-first";
  const second = "msg-second";
  assert.equal(recordMessageId(first), true);
  assert.equal(recordMessageId(second), true);
  assert.equal(wasMessageProcessed(first), true);
  assert.equal(wasMessageProcessed(second), true);
});
