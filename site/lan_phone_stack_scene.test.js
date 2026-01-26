/**
 * Tests for lan_phone_stack_scene viewport behavior.
 * Usage: node --test site/lan_phone_stack_scene.test.js
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
  path.join(__dirname, "lan_phone_stack_scene.html"),
  "utf8"
);

test("lan phone stack scene syncs viewport size and offsets", () => {
  assert.match(source, /visualViewport/);
  assert.match(source, /offsetLeft/);
  assert.match(source, /offsetTop/);
  assert.match(source, /viewportEl\.style\.width/);
  assert.match(source, /viewportEl\.style\.height/);
  assert.match(source, /viewportEl\.style\.transform/);
});
