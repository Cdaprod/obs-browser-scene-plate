/**
 * Tests for media registry resolution helper.
 * Usage: node --test program-monitor/media-registry.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeAssetId,
  parseMediaInput,
  resolveMediaEntries,
  getRegistryBaseUrl
} from "./media-registry.js";

test("normalizeAssetId accepts prefixed and bare sha256", () => {
  const sha = "a".repeat(64);
  assert.equal(normalizeAssetId(`sha256:${sha}`), `sha256:${sha}`);
  assert.equal(normalizeAssetId(sha), `sha256:${sha}`);
  assert.equal(normalizeAssetId("bad"), "");
});

test("parseMediaInput supports asset_id prefix and fallback pipe", () => {
  const sha = "b".repeat(64);
  const parsed = parseMediaInput(`asset_id: sha256:${sha}|https://fallback.local/video.mp4`);
  assert.equal(parsed.assetId, `sha256:${sha}`);
  assert.equal(parsed.fallbackPath, "https://fallback.local/video.mp4");
  assert.equal(parsed.isIdentity, true);
});

test("resolveMediaEntries uses batch endpoint and returns stream URL", async () => {
  const sha = "c".repeat(64);
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      async json() {
        return {
          results: {
            [`sha256:${sha}`]: {
              asset_id: `sha256:${sha}`,
              urls: { stream: "https://cdn.local/stream.mp4", download: "https://cdn.local/download.mp4" },
              origin: "obs",
              orientation: { rotation: 0, normalized: true }
            }
          },
          missing: []
        };
      }
    };
  };

  const [entry] = await resolveMediaEntries(
    [{ input: `sha256:${sha}` }],
    {
      fetchImpl,
      env: { MEDIA_SYNC_REGISTRY_BASE_URL: "http://registry.local" },
      cache: new Map(),
      timeoutMs: 500
    }
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://registry.local/api/registry/resolve");
  assert.equal(entry.finalMediaUrl, "https://cdn.local/stream.mp4");
  assert.equal(entry.resolvedVia, "registry");
  assert.equal(entry.origin, "obs");
});

test("resolveMediaEntries falls back on failure/timeout behavior", async () => {
  const sha = "d".repeat(64);
  const [entry] = await resolveMediaEntries(
    [{ input: `sha256:${sha}|https://fallback.local/file.mov` }],
    {
      fetchImpl: async () => {
        throw new Error("network down");
      },
      env: { MEDIA_SYNC_REGISTRY_BASE_URL: "http://registry.local" },
      cache: new Map(),
      timeoutMs: 20
    }
  );

  assert.equal(entry.finalMediaUrl, "https://fallback.local/file.mov");
  assert.equal(entry.resolvedVia, "fallback");
});

test("resolveMediaEntries uses MEDIA_SYNC_REGISTRY_BASE_URL exactly", async () => {
  assert.equal(getRegistryBaseUrl({ MEDIA_SYNC_REGISTRY_BASE_URL: "http://registry.local/" }), "http://registry.local");
  const [entry] = await resolveMediaEntries(
    [{ input: "https://example.com/direct.mp4" }],
    { env: { MEDIA_SYNC_REGISTRY_BASE_URL: "" } }
  );
  assert.equal(entry.finalMediaUrl, "https://example.com/direct.mp4");
});
