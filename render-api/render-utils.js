/**
 * Render utility helpers for duration inference and argument parsing.
 */

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_SECONDS = 4;
const DEFAULT_PAD_SECONDS = 0.25;

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function parseOptionalNumber(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isSecondsKey(key) {
  return ['seconds', 'duration', 'len', 'time'].includes(key);
}

function isMillisecondsKey(key) {
  if (['hold', 'ms', 'delay', 'fade', 'fadein', 'fadeout', 'in', 'out'].includes(key)) {
    return true;
  }
  return key.includes('ms');
}

function inferDurationFromQuery(urlString) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch (err) {
    return null;
  }

  let secondsCandidate = null;
  let totalMs = 0;

  for (const [rawKey, rawValue] of parsed.searchParams.entries()) {
    const key = rawKey.toLowerCase();
    const numeric = parseOptionalNumber(rawValue);
    if (numeric === null || numeric <= 0) {
      continue;
    }

    if (isSecondsKey(key)) {
      secondsCandidate = Math.max(secondsCandidate || 0, numeric);
      continue;
    }

    if (isMillisecondsKey(key)) {
      totalMs += numeric;
    }
  }

  if (secondsCandidate !== null) {
    return secondsCandidate;
  }

  if (totalMs > 0) {
    return totalMs / 1000;
  }

  return null;
}

function resolveRenderSeconds({
  explicitSeconds,
  pageSeconds,
  querySeconds,
  padSeconds = DEFAULT_PAD_SECONDS,
  defaultSeconds = DEFAULT_SECONDS
}) {
  const baseSeconds =
    explicitSeconds ??
    pageSeconds ??
    querySeconds ??
    defaultSeconds;

  const paddedSeconds = baseSeconds + padSeconds;
  return Math.max(0.01, paddedSeconds);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function safeReadJson(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    return fallback;
  }
}

function safeWriteJsonAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  ensureDir(dir);
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}

function normalizeProjectName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ');
}

module.exports = {
  DEFAULT_PAD_SECONDS,
  DEFAULT_SECONDS,
  ensureDir,
  inferDurationFromQuery,
  normalizeProjectName,
  parseArgs,
  parseOptionalNumber,
  resolveRenderSeconds,
  safeReadJson,
  safeWriteJsonAtomic
};
