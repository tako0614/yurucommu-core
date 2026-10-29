import { describe, expect, test } from "bun:test";
import { createHash, createHmac, hkdfSync } from "node:crypto";

import {
  base64UrlDecode,
  base64UrlEncode,
  buildDeclarativeWebPushMessage,
  classifyWebPushResponse,
  clearVapidJwtCache,
  deriveVapidKeyPair,
  deriveVapidPrivateScalar,
  encryptWebPushPayload,
  getInstanceVapidKeyPair,
  instanceWebPushTopic,
  isP256UncompressedPoint,
  isValidTopic,
  MAX_WEB_PUSH_PLAINTEXT_BYTES,
  p256PublicKeyFromPrivate,
  parseVapidDerivationSecret,
  sendWebPush,
  vapidAuthorization,
  VAPID_JWT_LIFETIME_SECONDS,
  VAPID_KEY_LABEL,
  WEB_PUSH_TOPIC_KEY_LABEL,
} from "../../lib/web-push/index.ts";
import {
  createTestUserAgent,
  decryptWebPushBody,
  importEcdhPrivateKey,
  verifyVapidAuthorization,
} from "../helpers/web-push-receiver.ts";

function b64(value: string): Uint8Array {
  const bytes = base64UrlDecode(value.replace(/\s+/g, ""));
  if (!bytes) throw new Error(`bad base64url fixture: ${value}`);
  return bytes;
}

// RFC 8291 §5 and Appendix A.
const RFC8291 = {
  plaintext: "When I grow up, I want to be a watermelon",
  asPublic:
    "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  uaPublic:
    "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  authSecret: "BTBZMqHH6r4Tts7J_aSIgg",
  body:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml" +
    "mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT" +
    "pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
} as const;

const SECRET_HEX = "a1".repeat(32);

describe("RFC 8291 encryption", () => {
  test("reproduces the Appendix A message byte for byte", async () => {
    const senderPublic = b64(RFC8291.asPublic);
    const body = await encryptWebPushPayload({
      plaintext: new TextEncoder().encode(RFC8291.plaintext),
      userAgentPublicKey: b64(RFC8291.uaPublic),
      authSecret: b64(RFC8291.authSecret),
      salt: b64(RFC8291.salt),
      senderKeyPair: {
        privateKey: await importEcdhPrivateKey(
          b64(RFC8291.asPrivate),
          senderPublic,
        ),
        publicKey: senderPublic,
      },
    });
    expect(base64UrlEncode(body)).toBe(RFC8291.body);
  });

  test("the Appendix A user agent decrypts the vector back to the plaintext", async () => {
    const uaPublic = b64(RFC8291.uaPublic);
    const plaintext = await decryptWebPushBody(b64(RFC8291.body), {
      privateKey: await importEcdhPrivateKey(b64(RFC8291.uaPrivate), uaPublic),
      p256dh: uaPublic,
      auth: b64(RFC8291.authSecret),
    });
    expect(new TextDecoder().decode(plaintext)).toBe(RFC8291.plaintext);
  });

  test("fresh salt and ephemeral key round-trip and never repeat", async () => {
    const agent = await createTestUserAgent();
    const plaintext = new TextEncoder().encode("こんにちは");
    const first = await encryptWebPushPayload({
      plaintext,
      userAgentPublicKey: agent.p256dh,
      authSecret: agent.auth,
    });
    const second = await encryptWebPushPayload({
      plaintext,
      userAgentPublicKey: agent.p256dh,
      authSecret: agent.auth,
    });
    expect(base64UrlEncode(first)).not.toBe(base64UrlEncode(second));
    // header: salt(16) || rs = 4096 || idlen = 65 || keyid(65)
    expect(new DataView(first.buffer).getUint32(16)).toBe(4096);
    expect(first[20]).toBe(65);
    expect(first.byteLength).toBe(86 + plaintext.byteLength + 1 + 16);
    expect(
      new TextDecoder().decode(await decryptWebPushBody(first, agent)),
    ).toBe("こんにちは");
  });

  test("refuses bad keys and oversized plaintext", async () => {
    const agent = await createTestUserAgent();
    const offCurve = new Uint8Array(agent.p256dh);
    offCurve[64] ^= 1;
    await expect(
      encryptWebPushPayload({
        plaintext: new Uint8Array(1),
        userAgentPublicKey: offCurve,
        authSecret: agent.auth,
      }),
    ).rejects.toThrow("p256dh");
    await expect(
      encryptWebPushPayload({
        plaintext: new Uint8Array(1),
        userAgentPublicKey: agent.p256dh,
        authSecret: new Uint8Array(15),
      }),
    ).rejects.toThrow("auth");
    await expect(
      encryptWebPushPayload({
        plaintext: new Uint8Array(MAX_WEB_PUSH_PLAINTEXT_BYTES + 1),
        userAgentPublicKey: agent.p256dh,
        authSecret: agent.auth,
      }),
    ).rejects.toThrow("exceeds");
  });
});

describe("P-256 helpers", () => {
  test("public points of the RFC 8291 private keys match the published ones", () => {
    expect(
      base64UrlEncode(p256PublicKeyFromPrivate(b64(RFC8291.asPrivate))),
    ).toBe(RFC8291.asPublic);
    expect(
      base64UrlEncode(p256PublicKeyFromPrivate(b64(RFC8291.uaPrivate))),
    ).toBe(RFC8291.uaPublic);
  });

  test("on-curve check accepts real points and refuses everything else", async () => {
    const agent = await createTestUserAgent();
    expect(isP256UncompressedPoint(agent.p256dh)).toBe(true);
    const tampered = new Uint8Array(agent.p256dh);
    tampered[40] ^= 0x80;
    expect(isP256UncompressedPoint(tampered)).toBe(false);
    const compressed = new Uint8Array(65);
    compressed[0] = 0x02;
    expect(isP256UncompressedPoint(compressed)).toBe(false);
    expect(isP256UncompressedPoint(agent.p256dh.subarray(0, 64))).toBe(false);
  });

  test("base64url decoding is strict", () => {
    expect(base64UrlDecode("AQID")).toEqual(Uint8Array.of(1, 2, 3));
    expect(base64UrlDecode("AQID=")).toBeNull();
    expect(base64UrlDecode("AQ+D")).toBeNull();
    expect(base64UrlDecode("AQ ID")).toBeNull();
    // Non-canonical trailing bits.
    expect(base64UrlDecode("AR")).toBeNull();
  });
});

describe("VAPID key derivation", () => {
  test("is deterministic for one secret and label and valid for WebCrypto", async () => {
    const secret = parseVapidDerivationSecret(SECRET_HEX)!;
    const first = await deriveVapidKeyPair(secret);
    const second = await deriveVapidKeyPair(secret);
    expect(first.publicKeyBase64Url).toBe(second.publicKeyBase64Url);
    expect(first.publicKey.byteLength).toBe(65);
    expect(isP256UncompressedPoint(first.publicKey)).toBe(true);
    // Pin the derivation so a silent change (label, info layout, salt) shows
    // up as a test failure: it would orphan every browser subscription. The
    // value was cross-checked with OpenSSL (node:crypto hkdfSync + ECDH
    // setPrivateKey/getPublicKey) on the same secret and info.
    expect(first.publicKeyBase64Url).toBe(
      "BDRxTd4Rivqt3ap8vw-WFCrX0obuu8byAW0zyZ6cn1p4F0-BVKOkmrVLq7AXHUDP4UXhdyByvDi50YZkM5UD6gc",
    );

    // The derived signing key verifies against the derived public point.
    const signature = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      first.privateKey,
      new TextEncoder().encode("probe"),
    );
    const verifier = await crypto.subtle.importKey(
      "raw",
      first.publicKey.slice().buffer,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    expect(
      await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        verifier,
        signature,
        new TextEncoder().encode("probe"),
      ),
    ).toBe(true);
  });

  test("changes with the secret and with the label version", async () => {
    const secret = parseVapidDerivationSecret(SECRET_HEX)!;
    const other = parseVapidDerivationSecret("b2".repeat(32))!;
    const base = await deriveVapidKeyPair(secret);
    expect((await deriveVapidKeyPair(other)).publicKeyBase64Url).not.toBe(
      base.publicKeyBase64Url,
    );
    expect(
      (await deriveVapidKeyPair(secret, "yurucommu/web-push/vapid/v2"))
        .publicKeyBase64Url,
    ).not.toBe(base.publicKeyBase64Url);
    expect(VAPID_KEY_LABEL).toBe("yurucommu/web-push/vapid/v1");
  });

  test("the scalar is HKDF-SHA256(secret, empty salt, label || 0x00 || counter)", async () => {
    const secret = parseVapidDerivationSecret(SECRET_HEX)!;
    const ikm = await crypto.subtle.importKey(
      "raw",
      secret.slice().buffer,
      "HKDF",
      false,
      ["deriveBits"],
    );
    const info = new Uint8Array([
      ...new TextEncoder().encode(VAPID_KEY_LABEL),
      0x00,
      0x00,
    ]);
    const expected = new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info },
        ikm,
        256,
      ),
    );
    expect(await deriveVapidPrivateScalar(secret)).toEqual(expected);
  });

  test("the instance key needs a 64-hex ENCRYPTION_KEY", async () => {
    expect(await getInstanceVapidKeyPair({})).toBeNull();
    expect(
      await getInstanceVapidKeyPair({ ENCRYPTION_KEY: "short" }),
    ).toBeNull();
    expect(
      await getInstanceVapidKeyPair({ ENCRYPTION_KEY: "zz".repeat(32) }),
    ).toBeNull();
    const instance = await getInstanceVapidKeyPair({
      ENCRYPTION_KEY: ` ${SECRET_HEX} `,
    });
    const direct = await deriveVapidKeyPair(
      parseVapidDerivationSecret(SECRET_HEX)!,
    );
    expect(instance?.publicKeyBase64Url).toBe(direct.publicKeyBase64Url);
  });
});

describe("VAPID authorization", () => {
  test("signs aud = endpoint origin, sub = instance origin, exp within 12h", async () => {
    clearVapidJwtCache();
    const keys = await deriveVapidKeyPair(
      parseVapidDerivationSecret(SECRET_HEX)!,
    );
    const now = Date.UTC(2026, 9, 29, 0, 0, 0);
    const header = await vapidAuthorization(
      keys,
      {
        endpoint: "https://fcm.googleapis.com/fcm/send/abc:def?x=1",
        subject: "https://yurucommu.example/some/path",
      },
      now,
    );
    const verified = await verifyVapidAuthorization(header);
    expect(verified.header).toEqual({ typ: "JWT", alg: "ES256" });
    expect(verified.claims).toEqual({
      aud: "https://fcm.googleapis.com",
      exp: now / 1000 + VAPID_JWT_LIFETIME_SECONDS,
      sub: "https://yurucommu.example",
    });
    expect(verified.claims.exp - now / 1000).toBeLessThanOrEqual(12 * 3600);
    expect(verified.publicKey).toBe(keys.publicKeyBase64Url);
  });

  test("reuses the JWT while valid and re-signs near expiry or per audience", async () => {
    clearVapidJwtCache();
    const keys = await deriveVapidKeyPair(
      parseVapidDerivationSecret(SECRET_HEX)!,
    );
    const subject = "https://yurucommu.example";
    const endpoint = "https://updates.push.services.mozilla.com/wpush/v2/x";
    const t0 = Date.UTC(2026, 9, 29);
    const first = await vapidAuthorization(keys, { endpoint, subject }, t0);
    const later = await vapidAuthorization(
      keys,
      { endpoint: `${endpoint}-other-subscription`, subject },
      t0 + 10 * 3600 * 1000,
    );
    expect(later).toBe(first);
    const renewed = await vapidAuthorization(
      keys,
      { endpoint, subject },
      t0 + 11.5 * 3600 * 1000,
    );
    expect(renewed).not.toBe(first);
    const otherAudience = await vapidAuthorization(
      keys,
      { endpoint: "https://web.push.apple.com/QH", subject },
      t0,
    );
    expect((await verifyVapidAuthorization(otherAudience)).claims.aud).toBe(
      "https://web.push.apple.com",
    );
  });
});

describe("push service response handling", () => {
  const now = Date.UTC(2026, 9, 29);
  test.each([
    [201, "delivered"],
    [202, "delivered"],
    [404, "gone"],
    [410, "gone"],
    [408, "retry"],
    [429, "retry"],
    [500, "retry"],
    [503, "retry"],
    [301, "failed"],
    [302, "failed"],
    [400, "failed"],
    [401, "failed"],
    [403, "failed"],
    [413, "failed"],
    [0, "failed"],
  ] as const)("HTTP %i → %s", (status, kind) => {
    expect(classifyWebPushResponse(status, null, now).kind).toBe(kind);
  });

  test("Retry-After accepts seconds and HTTP dates, capped at 12h", () => {
    const seconds = classifyWebPushResponse(429, "120", now);
    expect(seconds).toMatchObject({ kind: "retry", retryAfterSeconds: 120 });
    const date = classifyWebPushResponse(
      503,
      new Date(now + 90_000).toUTCString(),
      now,
    );
    expect(date).toMatchObject({ kind: "retry", retryAfterSeconds: 90 });
    expect(classifyWebPushResponse(429, "999999", now)).toMatchObject({
      retryAfterSeconds: 12 * 3600,
    });
  });
});

describe("sendWebPush", () => {
  test("posts an encrypted RFC 8030 request with VAPID, TTL, Urgency and Topic and never follows redirects", async () => {
    clearVapidJwtCache();
    const keys = await deriveVapidKeyPair(
      parseVapidDerivationSecret(SECRET_HEX)!,
    );
    const agent = await createTestUserAgent();
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const outcome = await sendWebPush(
      {
        endpoint: "https://push.example.net/push/abc",
        p256dh: agent.p256dh,
        auth: agent.auth,
      },
      {
        payload: '{"web_push":8030}',
        urgency: "high",
        topic: "conversation_1",
      },
      {
        vapid: keys,
        subject: "https://yurucommu.example",
        fetch: (async (url: string, init: RequestInit) => {
          seen.push({ url, init });
          return new Response(null, { status: 201 });
        }) as unknown as typeof fetch,
      },
    );
    expect(outcome).toEqual({ kind: "delivered", status: 201 });
    const request = seen[0]!;
    expect(request.url).toBe("https://push.example.net/push/abc");
    expect(request.init.method).toBe("POST");
    expect(request.init.redirect).toBe("manual");
    const headers = new Headers(request.init.headers);
    expect(headers.get("Content-Encoding")).toBe("aes128gcm");
    expect(headers.get("TTL")).toBe("172800");
    expect(headers.get("Urgency")).toBe("high");
    expect(headers.get("Topic")).toBe("conversation_1");
    const vapid = await verifyVapidAuthorization(headers.get("Authorization"));
    expect(vapid.claims.aud).toBe("https://push.example.net");
    const body = new Uint8Array(request.init.body as ArrayBuffer);
    expect(
      new TextDecoder().decode(await decryptWebPushBody(body, agent)),
    ).toBe('{"web_push":8030}');
  });

  test("transport errors and timeouts retry; unbuildable messages fail", async () => {
    const keys = await deriveVapidKeyPair(
      parseVapidDerivationSecret(SECRET_HEX)!,
    );
    const agent = await createTestUserAgent();
    const target = {
      endpoint: "https://push.example.net/push/abc",
      p256dh: agent.p256dh,
      auth: agent.auth,
    };
    const transport = await sendWebPush(
      target,
      { payload: "x" },
      {
        vapid: keys,
        subject: "https://yurucommu.example",
        fetch: (async () => {
          throw new TypeError("connection reset");
        }) as unknown as typeof fetch,
      },
    );
    expect(transport).toMatchObject({ kind: "retry", status: null });

    const timedOut = await sendWebPush(
      target,
      { payload: "x" },
      {
        vapid: keys,
        subject: "https://yurucommu.example",
        timeoutMs: 20,
        fetch: ((_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          })) as unknown as typeof fetch,
      },
    );
    expect(timedOut).toMatchObject({
      kind: "retry",
      error: "push service timed out",
    });

    const badTopic = await sendWebPush(
      target,
      { payload: "x", topic: "not a valid topic!" },
      {
        vapid: keys,
        subject: "https://yurucommu.example",
        fetch: (async () => {
          throw new Error("must not be called");
        }) as unknown as typeof fetch,
      },
    );
    expect(badTopic).toMatchObject({ kind: "failed" });
  });
});

describe("Declarative Web Push payload", () => {
  test("has web_push 8030, title and same-origin navigate", () => {
    const { message, bytes } = buildDeclarativeWebPushMessage({
      appOrigin: "https://yurucommu.example",
      title: "Yurucommu",
      body: "さくらさんがあなたをフォローしました",
      navigate: "/notifications",
      lang: "ja-JP",
      tag: "notifications",
      appBadge: 3,
    });
    expect(message).toEqual({
      web_push: 8030,
      notification: {
        title: "Yurucommu",
        body: "さくらさんがあなたをフォローしました",
        navigate: "https://yurucommu.example/notifications",
        lang: "ja-JP",
        tag: "notifications",
        app_badge: "3",
      },
    });
    expect(JSON.parse(new TextDecoder().decode(bytes))).toEqual(message);
  });

  test("never navigates to another origin", () => {
    for (const navigate of [
      "https://evil.example/phish",
      "//evil.example/x",
      "javascript:alert(1)",
      "https://user:pass@yurucommu.example/x",
    ]) {
      expect(
        buildDeclarativeWebPushMessage({
          appOrigin: "https://yurucommu.example",
          title: "Yurucommu",
          navigate,
        }).message.notification.navigate,
      ).toBe("https://yurucommu.example/");
    }
  });

  test("shortens the body to stay within 2048 bytes and drops invalid fields", () => {
    const { message, bytes } = buildDeclarativeWebPushMessage({
      appOrigin: "https://yurucommu.example",
      title: "Yurucommu",
      body: "あ".repeat(2000),
      navigate: "/",
      lang: "not a tag",
      appBadge: -1,
    });
    expect(bytes.byteLength).toBeLessThanOrEqual(2048);
    expect(message.notification.body?.endsWith("…")).toBe(true);
    expect(message.notification).not.toHaveProperty("lang");
    expect(message.notification).not.toHaveProperty("app_badge");
  });
});

describe("DM Topic", () => {
  const key = "5e".repeat(32);
  const alice = "https://yuru.test/ap/users/alice";
  const bob = "https://yuru.test/ap/users/bob";
  // Conversation ids are derived from the two public actor ids, so anyone can
  // compute them; the Topic must not be a function of this value alone.
  const conversation = `https://yuru.test/ap/conversations/${Buffer.from(
    [alice, bob].sort().join("\n"),
  ).toString("base64url")}`;

  function independent(secretHex: string, recipient: string): string {
    const macKey = Buffer.from(
      hkdfSync(
        "sha256",
        Buffer.from(secretHex, "hex"),
        Buffer.alloc(0),
        Buffer.from("yurucommu/web-push/topic/v1"),
        32,
      ),
    );
    const recipientBytes = Buffer.from(recipient, "utf8");
    const length = Buffer.alloc(4);
    length.writeUInt32BE(recipientBytes.byteLength);
    return createHmac("sha256", macKey)
      .update(
        Buffer.concat([length, recipientBytes, Buffer.from(conversation)]),
      )
      .digest()
      .subarray(0, 24)
      .toString("base64url");
  }

  test("is HMAC(HKDF(ENCRYPTION_KEY, label), recipient || conversation), 24 bytes", async () => {
    expect(WEB_PUSH_TOPIC_KEY_LABEL).toBe("yurucommu/web-push/topic/v1");
    const topic = await instanceWebPushTopic(
      { ENCRYPTION_KEY: key },
      alice,
      conversation,
    );
    expect(topic).toBe(independent(key, alice));
    expect(topic).toHaveLength(32);
    expect(isValidTopic(topic!)).toBe(true);
    // Stable across calls (collapse needs the same value every time).
    expect(
      await instanceWebPushTopic({ ENCRYPTION_KEY: key }, alice, conversation),
    ).toBe(topic);
  });

  test("differs per recipient, so the two devices of one DM are not linked", async () => {
    const forAlice = await instanceWebPushTopic(
      { ENCRYPTION_KEY: key },
      alice,
      conversation,
    );
    const forBob = await instanceWebPushTopic(
      { ENCRYPTION_KEY: key },
      bob,
      conversation,
    );
    expect(forAlice).not.toBe(forBob);
  });

  test("cannot be reproduced without ENCRYPTION_KEY", async () => {
    const topic = await instanceWebPushTopic(
      { ENCRYPTION_KEY: key },
      alice,
      conversation,
    );
    // Not a plain hash of public values...
    for (const guess of [
      conversation,
      `${alice}${conversation}`,
      `${alice}\n${conversation}`,
    ]) {
      expect(
        createHash("sha256")
          .update(guess)
          .digest()
          .subarray(0, 24)
          .toString("base64url"),
      ).not.toBe(topic);
    }
    // ...and another instance secret gives an unrelated value.
    expect(
      await instanceWebPushTopic(
        { ENCRYPTION_KEY: "a7".repeat(32) },
        alice,
        conversation,
      ),
    ).not.toBe(topic);
    // Without a valid key there is no Topic at all.
    expect(
      await instanceWebPushTopic({ ENCRYPTION_KEY: "" }, alice, conversation),
    ).toBeNull();
    expect(await instanceWebPushTopic({}, alice, conversation)).toBeNull();
  });

  test("keeps the recipient and conversation fields unambiguous", async () => {
    // Moving bytes across the boundary must change the MAC input.
    const a = await instanceWebPushTopic(
      { ENCRYPTION_KEY: key },
      "https://yuru.test/a",
      "bc",
    );
    const b = await instanceWebPushTopic(
      { ENCRYPTION_KEY: key },
      "https://yuru.test/ab",
      "c",
    );
    expect(a).not.toBe(b);
  });
});
