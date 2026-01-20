/**
 * Tests for Topic Dial shared helpers.
 * Usage: node --test site/overlays/topic_dial_custom_logic.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  splitLabelsString,
  buildTopicsFromParams,
  parseLandingIndex
} = require("./topic_dial_custom_logic.js");

const DEFAULTS = [
  "FAMILY",
  "THE STORY",
  "THE BUILD",
  "THE CRAFT",
  "PRINCIPLES",
  "PROCESS"
];

test("splitLabelsString supports pipe and comma delimiters", () => {
  assert.deepEqual(splitLabelsString("A|B|C"), ["A", "B", "C"]);
  assert.deepEqual(splitLabelsString("A, B ,C"), ["A", "B", "C"]);
});

test("buildTopicsFromParams applies count and slot overrides", () => {
  const params = {
    n: "2",
    labels: "ALPHA|BRAVO|CHARLIE",
    t: (i) => (i === 2 ? "DELTA" : null)
  };

  const result = buildTopicsFromParams({
    params,
    defaults: DEFAULTS,
    maxCount: 24
  });

  assert.deepEqual(result, ["ALPHA", "DELTA"]);
});

test("buildTopicsFromParams fills defaults when count exceeds labels", () => {
  const params = {
    n: "4",
    labels: "ALPHA|BRAVO",
    t: () => null
  };

  const result = buildTopicsFromParams({
    params,
    defaults: DEFAULTS,
    maxCount: 24
  });

  assert.deepEqual(result, ["ALPHA", "BRAVO", "THE BUILD", "THE CRAFT"]);
});

test("parseLandingIndex clamps and ignores random", () => {
  assert.equal(parseLandingIndex("random", 6), null);
  assert.equal(parseLandingIndex("0", 6), null);
  assert.equal(parseLandingIndex("3", 6), 3);
  assert.equal(parseLandingIndex("12", 6), 6);
});
