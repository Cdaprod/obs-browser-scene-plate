import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";

const OVERLAY_PATH = new URL("./compression_artifact_glitch.html", import.meta.url);

test("compression artifact glitch documents default URL params", async () => {
  const html = await readFile(OVERLAY_PATH, "utf8");
  const defaultUrlLine = html
    .split("\n")
    .find((line) => line.includes("Default URL (full params):")) ?? "";
  const defaultUrlValue = html
    .split("\n")
    .find((line) => line.includes("compression_artifact_glitch.html?")) ?? "";

  assert.ok(defaultUrlLine, "Default URL label should exist.");
  assert.ok(
    defaultUrlValue.includes("density=0.65") && defaultUrlValue.includes("sizeMax=60"),
    "Default URL should include density and sizeMax params."
  );
  assert.ok(
    html.includes("compression_artifact_glitch.html — “COMPRESSION PIXEL SCRAMBLE”"),
    "Overlay should include the documentation title."
  );
});
