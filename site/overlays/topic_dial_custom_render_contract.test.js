import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";

const OVERLAY_PATH = new URL("./topic_dial_custom.html", import.meta.url);

test("topic_dial_custom exposes deterministic render clock hooks", async () => {
  const html = await readFile(OVERLAY_PATH, "utf8");
  assert.ok(
    html.includes("window.__SET_RENDER_TIME = (ms) =>") && html.includes("applyFrameByTime(ms)"),
    "Overlay should expose __SET_RENDER_TIME for deterministic frame stepping."
  );
  assert.ok(
    html.includes("window.__RENDER_READY = true"),
    "Overlay should mark __RENDER_READY for renderer synchronization."
  );
  assert.ok(
    html.includes("window.__RENDER_SECONDS") && html.includes("render:duration"),
    "Overlay should publish render duration metadata for export duration resolution."
  );
  assert.ok(
    html.includes("const renderCapture = window.__RENDER_CAPTURE === true"),
    "Overlay should support render-capture mode to avoid wall-clock autospin drift."
  );
});
