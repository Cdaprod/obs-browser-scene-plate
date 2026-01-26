import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";

const OVERLAY_PATH = new URL("./centered_text_segmented_typewriter.html", import.meta.url);

test("centered_text_segmented_typewriter documents audio defaults", async () => {
  const html = await readFile(OVERLAY_PATH, "utf8");
  const defaultUrlLine = html
    .split("\n")
    .find((line) => line.includes("Default URL (full params):")) ?? "";
  const defaultUrlValue = html
    .split("\n")
    .find((line) => line.includes("centered_text_segmented_typewriter.html?")) ?? "";

  assert.ok(defaultUrlLine, "Default URL label should exist.");
  assert.ok(
    defaultUrlValue.includes("audio=0") && defaultUrlValue.includes("unlock=auto"),
    "Default URL should include audio and unlock params."
  );
  assert.ok(
    html.includes("unlock=auto|gesture  audio unlock strategy"),
    "Audio param docs should describe unlock modes."
  );
});
