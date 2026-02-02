/**
 * Tests for realtime_captions overlay docs.
 * Usage: node --test site/overlays/realtime_captions.test.js
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
  path.join(__dirname, "realtime_captions.html"),
  "utf8"
);

test("realtime captions overlay documents default URL", () => {
  assert.match(source, /Default URL \(full params\):/);
  assert.match(
    source,
    /realtime_captions\.html\?ws=ws:\/\/127\.0\.0\.1:8770&size=48&width=88&hold=1800&fade=220&bg=0,0,0,0\.4&fg=255,255,255,0\.96&blur=12&weight=700&line=1\.15&final=0/
  );
});
