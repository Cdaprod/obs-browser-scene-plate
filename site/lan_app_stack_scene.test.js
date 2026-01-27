/**
 * Tests for lan_app_stack_scene carousel behavior.
 * Usage: node --test site/lan_app_stack_scene.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

process.on("uncaughtException", (error) => {
  console.error(error);
  process.exitCode = 1;
});

process.on("unhandledRejection", (error) => {
  console.error(error);
  process.exitCode = 1;
});

const source = fs.readFileSync(
  path.join(__dirname, "lan_app_stack_scene.html"),
  "utf8"
);

test("lan app stack scene wires rolodex autoplay and wrap helpers", () => {
  assert.match(source, /AUTO/);
  assert.match(source, /updateRolodex/);
  assert.match(source, /wrapDelta/);
  assert.match(source, /pauseAutoplay/);
});
