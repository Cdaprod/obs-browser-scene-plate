/**
 * Tests for Program Monitor OBS auth helpers.
 * Usage: node --test program-monitor/obs-auth.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { buildObsAuth, sha256Base64 } = require("./obs-auth.js");

process.on("uncaughtException", (error) => {
  console.error(error);
  process.exitCode = 1;
});

process.on("unhandledRejection", (error) => {
  console.error(error);
  process.exitCode = 1;
});

function sha256Base64Node(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("base64");
}

test("sha256Base64 matches node crypto output without webcrypto", async () => {
  const input = "hello world";
  const expected = sha256Base64Node(input);
  const actual = await sha256Base64(input, { useWebCrypto: false });
  assert.equal(actual, expected);
});

test("buildObsAuth matches OBS auth formula", async () => {
  const password = "secret";
  const challenge = "challenge";
  const salt = "salt";
  const secret = sha256Base64Node(`${password}${salt}`);
  const expected = sha256Base64Node(`${secret}${challenge}`);
  const actual = await buildObsAuth(password, challenge, salt, { useWebCrypto: false });
  assert.equal(actual, expected);
});
