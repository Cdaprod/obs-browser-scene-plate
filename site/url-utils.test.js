/**
 * Tests for URL helper extraction.
 * Usage: node --test site/url-utils.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");

process.on("uncaughtException", (error) => {
  console.error(error);
  process.exitCode = 1;
});

process.on("unhandledRejection", (error) => {
  console.error(error);
  process.exitCode = 1;
});

const { extractDefaultUrlFromSource } = require("./url-utils.js");

test("extractDefaultUrlFromSource returns the full default URL line", () => {
  const source = [
    "/**",
    " * Default URL (full params):",
    " *  http://<HOST_IP>:8789/overlays/analogue_dust_loop.html?alpha=0.12&grain=0.55&dust=0.40",
    " */"
  ].join("\n");

  assert.equal(
    extractDefaultUrlFromSource(source),
    "http://<HOST_IP>:8789/overlays/analogue_dust_loop.html?alpha=0.12&grain=0.55&dust=0.40"
  );
});

test("extractDefaultUrlFromSource returns empty string when missing", () => {
  assert.equal(extractDefaultUrlFromSource("no defaults here"), "");
});
