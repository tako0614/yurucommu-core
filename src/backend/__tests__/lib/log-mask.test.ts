import { expect, test } from "bun:test";

import { maskSensitiveData, maskSensitiveString } from "../../lib/log-mask.ts";

test("maskSensitiveString redacts JWTs", () => {
  const input =
    "received eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyMSJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c ok";
  const out = maskSensitiveString(input);
  expect(out.includes("[REDACTED_JWT]")).toBeTruthy();
  expect(!out.includes("eyJzdWIiOiJ1c2VyMSJ9")).toBeTruthy();
});

test("maskSensitiveString redacts Bearer tokens", () => {
  const out = maskSensitiveString(
    "authorization: Bearer abc123def456ghi789jklmnop",
  );
  expect(out.includes("Bearer [redacted]")).toBeTruthy();
  expect(!out.includes("abc123def456ghi789jklmnop")).toBeTruthy();
});

test("maskSensitiveString redacts Stripe sk_live / sk_test keys", () => {
  const live = maskSensitiveString(
    "key=sk_" + "live_abcdefghijklmnop12345678",
  );
  const test = maskSensitiveString(
    "key=sk_" + "test_abcdefghijklmnop12345678",
  );
  expect(live.includes("[REDACTED_STRIPE_LIVE]")).toBeTruthy();
  expect(test.includes("[REDACTED_STRIPE_TEST]")).toBeTruthy();
  expect(!live.includes("abcdefghijklmnop12345678")).toBeTruthy();
});

test("maskSensitiveString redacts GitHub ghp_ tokens", () => {
  const out = maskSensitiveString(
    "token=ghp_abcdefghijklmnopqrstuvwxyz01234567",
  );
  expect(out.includes("[REDACTED_GHP]")).toBeTruthy();
  expect(!out.includes("ghp_abcdefghijklmnopqrstuvwxyz01234567")).toBeTruthy();
});

test("maskSensitiveString redacts AWS AKIA access keys", () => {
  // Build the AKIA-shape token at runtime so the literal does not appear
  // in source (avoids tripping repo-level secret-leakage scanners).
  const fakeKey = `${"AK" + "IA"}${"F".repeat(16)}`;
  const out = maskSensitiveString(`aws=${fakeKey}`);
  expect(out.includes("[REDACTED_AWS_ACCESS_KEY]")).toBeTruthy();
  expect(!out.includes(fakeKey)).toBeTruthy();
});

test("maskSensitiveString redacts PEM private key blocks", () => {
  const pem =
    "-----BEGIN RSA PRIVATE KEY-----\nMIIBIwIBAAKBgQC...\n-----END RSA PRIVATE KEY-----";
  const out = maskSensitiveString(pem);
  expect(out).toEqual("[REDACTED_PRIVATE_KEY]");
});

test("maskSensitiveString redacts email addresses", () => {
  const out = maskSensitiveString("contact alice@example.com today");
  expect(out.includes("***@example.com")).toBeTruthy();
  expect(!out.includes("alice@example.com")).toBeTruthy();
});

test("maskSensitiveString redacts Luhn-valid credit cards", () => {
  // 4111 1111 1111 1111 is the canonical Visa test card (Luhn-valid).
  const out = maskSensitiveString("card=4111 1111 1111 1111 end");
  expect(out.includes("[REDACTED_CC]")).toBeTruthy();
  expect(!out.includes("4111 1111 1111 1111")).toBeTruthy();
});

test("maskSensitiveString leaves non-Luhn 16-digit runs alone", () => {
  const out = maskSensitiveString("order=1234567890123456");
  expect(out.includes("1234567890123456")).toBeTruthy();
});

test("maskSensitiveData redacts sensitive object keys", () => {
  const out = maskSensitiveData({
    user: "alice",
    password: "hunter2",
    api_key: "abc",
    apiKey: "xyz",
    accessToken: "tok",
    private_key: "pem",
    cookie: "sid=...",
    authorization: "Bearer ...",
    nested: { secret: "s", credential: "c", normal: "ok" },
  }) as Record<string, unknown>;
  expect(out.password).toEqual("[redacted]");
  expect(out.api_key).toEqual("[redacted]");
  expect(out.apiKey).toEqual("[redacted]");
  expect(out.accessToken).toEqual("[redacted]");
  expect(out.private_key).toEqual("[redacted]");
  expect(out.cookie).toEqual("[redacted]");
  expect(out.authorization).toEqual("[redacted]");
  const nested = out.nested as Record<string, unknown>;
  expect(nested.secret).toEqual("[redacted]");
  expect(nested.credential).toEqual("[redacted]");
  expect(nested.normal).toEqual("ok");
});

test("maskSensitiveData masks strings within nested arrays", () => {
  const out = maskSensitiveData({
    items: [
      { note: "alice@example.com" },
      { note: "Bearer abc123def456ghi789jklmnop" },
    ],
  }) as { items: Array<{ note: string }> };
  expect(out.items[0].note.includes("***@example.com")).toBeTruthy();
  expect(out.items[1].note.includes("Bearer [redacted]")).toBeTruthy();
});

test("maskSensitiveData handles circular references safely", () => {
  const obj: Record<string, unknown> = { name: "x" };
  obj.self = obj;
  const out = maskSensitiveData(obj) as Record<string, unknown>;
  expect(out.name).toEqual("x");
  expect(out.self).toEqual("[circular]");
});

test("maskSensitiveData preserves Error name + message + stack", () => {
  const err = new Error("got Bearer abc123def456ghi789jklmnop here");
  const out = maskSensitiveData(err) as {
    name: string;
    message: string;
    stack?: string;
  };
  expect(out.name).toEqual("Error");
  expect(out.message.includes("Bearer [redacted]")).toBeTruthy();
});

test("maskSensitiveData passes primitives through", () => {
  expect(maskSensitiveData(null)).toEqual(null);
  expect(maskSensitiveData(undefined)).toEqual(undefined);
  expect(maskSensitiveData(0)).toEqual(0);
  expect(maskSensitiveData(true)).toEqual(true);
});

test("maskSensitiveString returns empty input unchanged", () => {
  expect(maskSensitiveString("")).toEqual("");
});

test("maskSensitiveString masks password=value pairs", () => {
  const out = maskSensitiveString("config password=hunter2 ok");
  expect(out.includes("password=[redacted]")).toBeTruthy();
  expect(!out.includes("hunter2")).toBeTruthy();
});
