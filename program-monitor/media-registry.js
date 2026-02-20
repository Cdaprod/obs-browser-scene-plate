/**
 * Media registry resolution helpers for Program Monitor.
 * Usage:
 *   import { resolveMediaEntries } from "./media-registry.js";
 *   const out = await resolveMediaEntries([{ input: "sha256:..." }]);
 */

const SHA256_RE = /^[a-f0-9]{64}$/i;
const ASSET_ID_RE = /^sha256:([a-f0-9]{64})$/i;
const DEFAULT_TIMEOUT_MS = 500;
const DEFAULT_CACHE_TTL_MS = 60_000;

function normalizeAssetId(value) {
  if (!value) return "";
  const trimmed = String(value).trim();
  const match = trimmed.match(ASSET_ID_RE);
  if (match) {
    return `sha256:${match[1].toLowerCase()}`;
  }
  if (SHA256_RE.test(trimmed)) {
    return `sha256:${trimmed.toLowerCase()}`;
  }
  return "";
}

function parseMediaInput(input) {
  const text = String(input || "").trim();
  if (!text) {
    return { input: "", assetId: "", fallbackPath: "", isIdentity: false };
  }

  if (/^asset_id\s*:/i.test(text)) {
    const value = text.replace(/^asset_id\s*:/i, "").trim();
    const [identity, fallbackPath = ""] = value.split("|");
    const assetId = normalizeAssetId(identity);
    return { input: text, assetId, fallbackPath: fallbackPath.trim(), isIdentity: Boolean(assetId) };
  }

  const [identity, fallbackPath = ""] = text.split("|");
  const assetId = normalizeAssetId(identity);
  return { input: text, assetId, fallbackPath: fallbackPath.trim(), isIdentity: Boolean(assetId) };
}

function getRegistryBaseUrl(env = {}) {
  const value = env.MEDIA_SYNC_REGISTRY_BASE_URL || "";
  return String(value || "").trim().replace(/\/$/, "");
}

function mergeResult(entry, payload, source) {
  const streamUrl = payload?.urls?.stream || "";
  const downloadUrl = payload?.urls?.download || "";
  const finalMediaUrl = streamUrl || downloadUrl || entry.fallbackPath || entry.input;
  return {
    input: entry.input,
    assetId: entry.assetId,
    resolvedVia: source,
    finalMediaUrl,
    fallbackPath: entry.fallbackPath || "",
    origin: payload?.origin || "unknown",
    orientation: payload?.orientation || null,
    canonicalName: payload?.canonical_name || "",
    relativePath: payload?.relative_path || "",
    creationTime: payload?.timeline?.anchor_time || payload?.timestamps?.creation_time || "",
    timeline: payload?.timeline || null,
    facts: payload?.facts || null,
    sha256: payload?.sha256 || (entry.assetId ? entry.assetId.replace(/^sha256:/, "") : "")
  };
}

function withTimeout(signal, timeoutMs, onTimeout) {
  if (typeof AbortController === "undefined") {
    return { signal, cleanup: () => {} };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    onTimeout?.();
    controller.abort();
  }, timeoutMs);

  if (signal) {
    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timeout)
  };
}

export async function resolveMediaEntries(entries, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const env = options.env || (typeof window !== "undefined" ? window : {});
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
  const cacheTtlMs = Number.isFinite(options.cacheTtlMs) ? options.cacheTtlMs : DEFAULT_CACHE_TTL_MS;
  const cache = options.cache || new Map();
  const registryBaseUrl = getRegistryBaseUrl(env);

  const parsedEntries = (Array.isArray(entries) ? entries : []).map((entry) => {
    const parsed = parseMediaInput(entry?.input || entry || "");
    return {
      ...parsed,
      fallbackPath: entry?.fallbackPath || parsed.fallbackPath
    };
  });

  if (!registryBaseUrl) {
    return parsedEntries.map((entry) => mergeResult(entry, null, "fallback"));
  }

  const now = Date.now();
  const unresolved = [];
  const resolvedByAssetId = new Map();

  parsedEntries.forEach((entry) => {
    if (!entry.isIdentity) {
      resolvedByAssetId.set(entry.input, mergeResult(entry, null, "fallback"));
      return;
    }
    const cached = cache.get(entry.assetId);
    if (cached && cached.expiresAt > now) {
      resolvedByAssetId.set(entry.assetId, cached.value);
      return;
    }
    unresolved.push(entry);
  });

  if (unresolved.length) {
    const fallbackPaths = {};
    const assetIds = [];
    unresolved.forEach((entry) => {
      assetIds.push(entry.assetId);
      if (entry.fallbackPath) {
        fallbackPaths[entry.assetId] = entry.fallbackPath;
      }
    });

    const requestBody = JSON.stringify({ asset_ids: assetIds, fallback_paths: fallbackPaths });
    const { signal, cleanup } = withTimeout(options.signal, timeoutMs, () => {});
    try {
      const res = await fetchImpl(`${registryBaseUrl}/api/registry/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBody,
        signal
      });
      if (res.ok) {
        const data = await res.json();
        unresolved.forEach((entry) => {
          const payload = data?.results?.[entry.assetId] || null;
          const value = payload
            ? mergeResult(entry, payload, "registry")
            : mergeResult(entry, null, "fallback");
          resolvedByAssetId.set(entry.assetId, value);
          cache.set(entry.assetId, { value, expiresAt: now + cacheTtlMs });
        });
      } else {
        unresolved.forEach((entry) => {
          resolvedByAssetId.set(entry.assetId, mergeResult(entry, null, "fallback"));
        });
      }
    } catch (error) {
      unresolved.forEach((entry) => {
        resolvedByAssetId.set(entry.assetId, mergeResult(entry, null, "fallback"));
      });
    } finally {
      cleanup();
    }
  }

  return parsedEntries.map((entry) => {
    if (!entry.isIdentity) {
      return resolvedByAssetId.get(entry.input) || mergeResult(entry, null, "fallback");
    }
    return resolvedByAssetId.get(entry.assetId) || mergeResult(entry, null, "fallback");
  });
}

export {
  getRegistryBaseUrl,
  normalizeAssetId,
  parseMediaInput
};
