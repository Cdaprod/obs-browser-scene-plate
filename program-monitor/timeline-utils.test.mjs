/**
 * Tests for Program Monitor timeline utilities.
 * Usage: node --test program-monitor/timeline-utils.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  classifyUrl,
  getDurationHintSeconds,
  getPlaybackStartIndex,
  resolvePlaybackScope,
  isHttpUrl,
  parseNodeText,
  uuid,
  encodeTimelinePayload,
  decodeTimelinePayload,
  buildNodeDescriptor,
  buildTimelineDescriptor
} = require("./timeline-utils.js");

process.on("uncaughtException", (error) => {
  console.error(error);
  process.exitCode = 1;
});

process.on("unhandledRejection", (error) => {
  console.error(error);
  process.exitCode = 1;
});

test("parseNodeText trims lines and ignores comments", () => {
  const input = [
    "",
    "  http://example.com/base.mp4 ",
    "# comment",
    "// also a comment",
    " http://example.com/overlay.webm ",
    "http://example.com/track.mp3"
  ].join("\n");

  const parsed = parseNodeText(input);
  assert.equal(parsed.baseUrl, "http://example.com/base.mp4");
  assert.deepEqual(parsed.layers, [
    "http://example.com/overlay.webm",
    "http://example.com/track.mp3"
  ]);
});

test("parseNodeText supports explicit base line overrides", () => {
  const input = [
    "http://example.com/overlay.webm",
    "base: http://example.com/base.mp4",
    "http://example.com/track.mp3"
  ].join("\n");

  const parsed = parseNodeText(input);
  assert.equal(parsed.baseUrl, "http://example.com/base.mp4");
  assert.deepEqual(parsed.layers, [
    "http://example.com/overlay.webm",
    "http://example.com/track.mp3"
  ]);
});

test("parseNodeText prefers non-overlay base when overlay line comes first", () => {
  const input = [
    "http://example.com/overlays/glow.html",
    "http://example.com/base.mp4"
  ].join("\n");

  const parsed = parseNodeText(input);
  assert.equal(parsed.baseUrl, "http://example.com/base.mp4");
  assert.deepEqual(parsed.layers, ["http://example.com/overlays/glow.html"]);
});

test("classifyUrl detects media types", () => {
  assert.equal(classifyUrl("http://host/file.mp3"), "audio");
  assert.equal(classifyUrl("http://host/file.png"), "image");
  assert.equal(classifyUrl("http://host/file.html"), "page");
  assert.equal(classifyUrl("http://host/file.mp4"), "video");
});

test("isHttpUrl checks scheme", () => {
  assert.equal(isHttpUrl("http://host/file.mp4"), true);
  assert.equal(isHttpUrl("https://host/file.mp4"), true);
  assert.equal(isHttpUrl("file.mp4"), false);
});

test("getDurationHintSeconds reads duration params", () => {
  assert.equal(getDurationHintSeconds("http://host/base.html?duration=12"), 12);
  assert.equal(getDurationHintSeconds("http://host/base.html?duration=1200"), 1.2);
  assert.equal(getDurationHintSeconds("http://host/base.html?ms=4500"), 4.5);
});

test("getDurationHintSeconds sums component ms params", () => {
  const url = "http://host/base.html?in=200&out=300&hold=500&gap=250&pause=250";
  assert.equal(getDurationHintSeconds(url), 1.5);
});

test("getDurationHintSeconds supports numbered params", () => {
  const url = "http://host/base.html?hold1=200&hold2=300&hold3=500";
  assert.equal(getDurationHintSeconds(url), 1);
});

test("getDurationHintSeconds estimates typewriter timing", () => {
  const url = "http://host/base.html?s1=Hello&s2=World&cps=10";
  const estimate = getDurationHintSeconds(url);
  assert.ok(estimate > 0);
  assert.ok(estimate > 3);
});

test("uuid returns a non-empty string", () => {
  const value = uuid();
  assert.equal(typeof value, "string");
  assert.ok(value.length > 0);
});

test("getPlaybackStartIndex defaults to the first node when none is selected", () => {
  assert.equal(getPlaybackStartIndex(-1, 3), 0);
  assert.equal(getPlaybackStartIndex(undefined, 3), 0);
  assert.equal(getPlaybackStartIndex(5, 3), 0);
});

test("getPlaybackStartIndex returns -1 when no nodes exist", () => {
  assert.equal(getPlaybackStartIndex(0, 0), -1);
});

test("resolvePlaybackScope prefers selected nodes when valid", () => {
  assert.deepEqual(resolvePlaybackScope(2, 5), { mode: "node", startIndex: 2 });
});

test("resolvePlaybackScope defaults to timeline when selection is missing", () => {
  assert.deepEqual(resolvePlaybackScope(null, 4), { mode: "timeline", startIndex: 0 });
  assert.deepEqual(resolvePlaybackScope(10, 4), { mode: "timeline", startIndex: 0 });
});

test("resolvePlaybackScope returns empty when there are no nodes", () => {
  assert.deepEqual(resolvePlaybackScope(0, 0), { mode: "empty", startIndex: -1 });
});

test("buildNodeDescriptor categorizes overlays vs ambient", () => {
  const node = {
    id: "n1",
    text: [
      "http://host/base.mp4",
      "http://host/overlay.webm",
      "http://host/cover.png",
      "http://host/ambience.mp3"
    ].join("\n"),
    durationOverride: "3"
  };
  const descriptor = buildNodeDescriptor(node);
  assert.equal(descriptor.base.url, "http://host/base.mp4");
  assert.equal(descriptor.base.kind, "video");
  assert.equal(descriptor.overlays.length, 2);
  assert.equal(descriptor.ambient.length, 1);
});

test("buildTimelineDescriptor adds structured nodes", () => {
  const timeline = buildTimelineDescriptor({
    version: 1,
    nodes: [{ id: "n1", text: "http://host/base.html?dur=4", durationOverride: "" }],
    activeIndex: 0
  });
  assert.equal(timeline.nodesStructured.length, 1);
  assert.equal(timeline.nodesStructured[0].base.kind, "page");
});

test("encode/decode timeline payload round-trips", () => {
  const payload = {
    version: 1,
    nodes: [{ id: "a", text: "http://host/base.mp4", durationOverride: "3" }],
    activeIndex: 0
  };
  const encoded = encodeTimelinePayload(payload);
  assert.ok(encoded);
  const decoded = decodeTimelinePayload(encoded);
  assert.deepEqual(decoded, payload);
});

test("decodeTimelinePayload returns null on bad input", () => {
  assert.equal(decodeTimelinePayload("not-base64"), null);
});
