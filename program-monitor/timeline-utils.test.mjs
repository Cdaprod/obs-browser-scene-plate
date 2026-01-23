/**
 * Tests for Program Monitor timeline utilities.
 * Usage: node --test program-monitor/timeline-utils.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { classifyUrl, isHttpUrl, parseNodeText, uuid } = require("./timeline-utils.js");

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

test("classifyUrl detects media types", () => {
  assert.equal(classifyUrl("http://host/file.mp3"), "audio");
  assert.equal(classifyUrl("http://host/file.png"), "image");
  assert.equal(classifyUrl("http://host/file.mp4"), "video");
});

test("isHttpUrl checks scheme", () => {
  assert.equal(isHttpUrl("http://host/file.mp4"), true);
  assert.equal(isHttpUrl("https://host/file.mp4"), true);
  assert.equal(isHttpUrl("file.mp4"), false);
});

test("uuid returns a non-empty string", () => {
  const value = uuid();
  assert.equal(typeof value, "string");
  assert.ok(value.length > 0);
});
