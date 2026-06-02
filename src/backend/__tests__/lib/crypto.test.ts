import { expect, test } from "bun:test";
import { assertEquals, assertNotEquals, assertRejects } from "#test/assert";
import {
  decrypt,
  DecryptionError,
  encrypt,
  hashSessionId,
  hashSessionIdForEnv,
} from "../../lib/crypto.ts";

const KEY = "00".repeat(32);
const OTHER_KEY = "11".repeat(32);

test("crypto decrypt - rejects malformed encrypted payloads without plaintext fallback", async () => {
  for (const payload of [
    "plaintext-token",
    "abcd:",
    ":abcd",
    "abcd:efgh",
    "00:11",
    `${"00".repeat(12)}:${"11".repeat(16)}:extra`,
  ]) {
    await assertRejects(() => decrypt(payload, KEY), DecryptionError);
  }
});

test("crypto decrypt - round trips valid encrypted values", async () => {
  const encrypted = await encrypt("sensitive-token", KEY);
  expect(await decrypt(encrypted, KEY)).toEqual("sensitive-token");
});

test("crypto decrypt - rejects valid payloads with the wrong key", async () => {
  const encrypted = await encrypt("sensitive-token", KEY);
  await assertRejects(() => decrypt(encrypted, OTHER_KEY), DecryptionError);
});

test("hashSessionId - prefixes sha256: and never returns the raw id", async () => {
  const raw = "a".repeat(64);
  const hashed = await hashSessionId(raw, "salt-1");
  expect(hashed.startsWith("sha256:")).toEqual(true);
  expect(hashed).not.toEqual(raw);
  expect(hashed.includes(raw)).toEqual(false);
});

test("hashSessionId - deterministic for a given salt", async () => {
  const raw = "deadbeef";
  const a = await hashSessionId(raw, "salt-1");
  const b = await hashSessionId(raw, "salt-1");
  expect(a).toEqual(b);
});

test("hashSessionId - salt separates the hash space", async () => {
  const raw = "deadbeef";
  const a = await hashSessionId(raw, "salt-1");
  const b = await hashSessionId(raw, "salt-2");
  expect(a).not.toEqual(b);
});

test("hashSessionIdForEnv - uses the configured per-deployment salt", async () => {
  const raw = "deadbeef";
  const withSalt = await hashSessionIdForEnv(
    { YURUCOMMU_SESSION_HASH_SALT: "salt-1" },
    raw,
  );
  const expected = await hashSessionId(raw, "salt-1");
  expect(withSalt).toEqual(expected);
});

test("hashSessionIdForEnv - falls back to the dev salt when unset", async () => {
  const raw = "deadbeef";
  const fallback = await hashSessionIdForEnv({}, raw);
  // The dev fallback must differ from a real per-deployment salt.
  const real = await hashSessionIdForEnv(
    { YURUCOMMU_SESSION_HASH_SALT: "salt-1" },
    raw,
  );
  expect(fallback.startsWith("sha256:")).toEqual(true);
  expect(fallback).not.toEqual(real);
});
