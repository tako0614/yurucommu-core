import { assert, assertEquals } from "jsr:@std/assert";
import { maskSensitiveData, maskSensitiveString } from "../../lib/log-mask.ts";

Deno.test("maskSensitiveString redacts JWTs", () => {
  const input =
    "received eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyMSJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c ok";
  const out = maskSensitiveString(input);
  assert(out.includes("[REDACTED_JWT]"));
  assert(!out.includes("eyJzdWIiOiJ1c2VyMSJ9"));
});

Deno.test("maskSensitiveString redacts Bearer tokens", () => {
  const out = maskSensitiveString(
    "authorization: Bearer abc123def456ghi789jklmnop",
  );
  assert(out.includes("Bearer [redacted]"));
  assert(!out.includes("abc123def456ghi789jklmnop"));
});

Deno.test("maskSensitiveString redacts Stripe sk_live / sk_test keys", () => {
  const live = maskSensitiveString(
    "key=sk_" + "live_abcdefghijklmnop12345678",
  );
  const test = maskSensitiveString(
    "key=sk_" + "test_abcdefghijklmnop12345678",
  );
  assert(live.includes("[REDACTED_STRIPE_LIVE]"));
  assert(test.includes("[REDACTED_STRIPE_TEST]"));
  assert(!live.includes("abcdefghijklmnop12345678"));
});

Deno.test("maskSensitiveString redacts GitHub ghp_ tokens", () => {
  const out = maskSensitiveString(
    "token=ghp_abcdefghijklmnopqrstuvwxyz01234567",
  );
  assert(out.includes("[REDACTED_GHP]"));
  assert(!out.includes("ghp_abcdefghijklmnopqrstuvwxyz01234567"));
});

Deno.test("maskSensitiveString redacts AWS AKIA access keys", () => {
  const out = maskSensitiveString("aws=AKIAIOSFODNN7EXAMPLE");
  assert(out.includes("[REDACTED_AWS_ACCESS_KEY]"));
  assert(!out.includes("AKIAIOSFODNN7EXAMPLE"));
});

Deno.test("maskSensitiveString redacts PEM private key blocks", () => {
  const pem =
    "-----BEGIN RSA PRIVATE KEY-----\nMIIBIwIBAAKBgQC...\n-----END RSA PRIVATE KEY-----";
  const out = maskSensitiveString(pem);
  assertEquals(out, "[REDACTED_PRIVATE_KEY]");
});

Deno.test("maskSensitiveString redacts email addresses", () => {
  const out = maskSensitiveString("contact alice@example.com today");
  assert(out.includes("***@example.com"));
  assert(!out.includes("alice@example.com"));
});

Deno.test("maskSensitiveString redacts Luhn-valid credit cards", () => {
  // 4111 1111 1111 1111 is the canonical Visa test card (Luhn-valid).
  const out = maskSensitiveString("card=4111 1111 1111 1111 end");
  assert(out.includes("[REDACTED_CC]"));
  assert(!out.includes("4111 1111 1111 1111"));
});

Deno.test("maskSensitiveString leaves non-Luhn 16-digit runs alone", () => {
  const out = maskSensitiveString("order=1234567890123456");
  assert(out.includes("1234567890123456"));
});

Deno.test("maskSensitiveData redacts sensitive object keys", () => {
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
  assertEquals(out.password, "[redacted]");
  assertEquals(out.api_key, "[redacted]");
  assertEquals(out.apiKey, "[redacted]");
  assertEquals(out.accessToken, "[redacted]");
  assertEquals(out.private_key, "[redacted]");
  assertEquals(out.cookie, "[redacted]");
  assertEquals(out.authorization, "[redacted]");
  const nested = out.nested as Record<string, unknown>;
  assertEquals(nested.secret, "[redacted]");
  assertEquals(nested.credential, "[redacted]");
  assertEquals(nested.normal, "ok");
});

Deno.test("maskSensitiveData masks strings within nested arrays", () => {
  const out = maskSensitiveData({
    items: [
      { note: "alice@example.com" },
      { note: "Bearer abc123def456ghi789jklmnop" },
    ],
  }) as { items: Array<{ note: string }> };
  assert(out.items[0].note.includes("***@example.com"));
  assert(out.items[1].note.includes("Bearer [redacted]"));
});

Deno.test("maskSensitiveData handles circular references safely", () => {
  const obj: Record<string, unknown> = { name: "x" };
  obj.self = obj;
  const out = maskSensitiveData(obj) as Record<string, unknown>;
  assertEquals(out.name, "x");
  assertEquals(out.self, "[circular]");
});

Deno.test("maskSensitiveData preserves Error name + message + stack", () => {
  const err = new Error("got Bearer abc123def456ghi789jklmnop here");
  const out = maskSensitiveData(err) as {
    name: string;
    message: string;
    stack?: string;
  };
  assertEquals(out.name, "Error");
  assert(out.message.includes("Bearer [redacted]"));
});

Deno.test("maskSensitiveData passes primitives through", () => {
  assertEquals(maskSensitiveData(null), null);
  assertEquals(maskSensitiveData(undefined), undefined);
  assertEquals(maskSensitiveData(0), 0);
  assertEquals(maskSensitiveData(true), true);
});

Deno.test("maskSensitiveString returns empty input unchanged", () => {
  assertEquals(maskSensitiveString(""), "");
});

Deno.test("maskSensitiveString masks password=value pairs", () => {
  const out = maskSensitiveString("config password=hunter2 ok");
  assert(out.includes("password=[redacted]"));
  assert(!out.includes("hunter2"));
});
