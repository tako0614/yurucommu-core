import { describe, expect, it, vi, afterEach } from "vitest";
import adminPush from "./admin-push";

const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAElz2RiMa/yrG5zE4iDeK+TW1sHmHd
nPUL07SL7o3PIXvSspwM6vQ+HS/vJk5o7lr7BEok2Aw9D+fHsIetsqpFFg==
-----END PUBLIC KEY-----`;

const PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgreXr1EBRi+kyz3ZY
qqN6afVeru7HkjTLpWCS0RzBA8mhRANCAASXPZGIxr/KsbnMTiIN4r5NbWweYd2c
9QvTtIvujc8he9KynAzq9D4dL+8mTmjuWvsESiTYDD0P58ewh62yqkUW
-----END PRIVATE KEY-----`;

const authHeader = `Basic ${Buffer.from("admin:pass").toString("base64")}`;

const request = (
  body: Record<string, any>,
  envOverrides?: Record<string, any>,
  headers?: Record<string, string>,
) =>
  adminPush.request(
    "/admin/push/verify",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: authHeader,
        ...(headers ?? {}),
      },
      body: JSON.stringify(body ?? {}),
    },
    {
      AUTH_USERNAME: "admin",
      AUTH_PASSWORD: "pass",
      INSTANCE_DOMAIN: "example.com",
      ...(envOverrides ?? {}),
    },
  );

const originalFetch = global.fetch;

afterEach(() => {
  (global as any).fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("/admin/push/verify", () => {
  it("returns guidance when keys are missing", async () => {
    const res = await request({});
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data.keys.hasPublicKey).toBe(false);
    expect(json.data.wellKnown.status).toBe("missing");
    expect(json.data.testSend.status).toBe("skipped");
    expect(Array.isArray(json.data.guidance)).toBe(true);
    expect(json.data.guidance.length).toBeGreaterThan(0);
  });

  it("signs a payload and posts to the configured target", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true, delivered: 0 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    (global as any).fetch = fetchMock as any;

    const res = await request(
      {},
      {
        PUSH_REGISTRATION_PUBLIC_KEY: PUBLIC_KEY,
        PUSH_REGISTRATION_PRIVATE_KEY: PRIVATE_KEY,
        DEFAULT_PUSH_SERVICE_URL: "https://push.example.com/internal/push/events",
      },
    );

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.data.keys.hasPublicKey).toBe(true);
    expect(json.data.testPayload.signature).toBeTruthy();
    expect(json.data.testSend.status).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect((init as any).headers["X-Push-Signature"]).toBeDefined();
  });

  it("skips network sends when sendTest is false but still returns a signature", async () => {
    const fetchMock = vi.fn();
    (global as any).fetch = fetchMock as any;

    const res = await request(
      { sendTest: false },
      {
        PUSH_REGISTRATION_PUBLIC_KEY: PUBLIC_KEY,
        PUSH_REGISTRATION_PRIVATE_KEY: PRIVATE_KEY,
      },
    );

    const json: any = await res.json();
    expect(json.data.testSend.reason).toBe("sendTest disabled");
    expect(json.data.testPayload.signature).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
