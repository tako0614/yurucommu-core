import { describe, expect, it } from "vitest";
import { buildTakosAppEnv } from "./app-sdk-loader";

describe("buildTakosAppEnv", () => {
  it("exposes optional bindings/env vars on AppEnv", () => {
    const fakeDb = { name: "DB" };
    const fakeKv = { name: "KV" };
    const fakeBucket = { name: "MEDIA" };

    const c: any = {
      env: {
        DB: fakeDb,
        KV: fakeKv,
        MEDIA: fakeBucket,
        INSTANCE_DOMAIN: "example.test",
        JWT_SECRET: "secret",
      },
      req: {
        url: "http://localhost/",
        header: () => null,
      },
      get: () => null,
    };

    const env = buildTakosAppEnv(c, "default", { version: "1.0.0" } as any);
    expect(env.DB).toBe(fakeDb);
    expect(env.KV).toBe(fakeKv);
    expect(env.STORAGE).toBe(fakeBucket);
    expect(env.INSTANCE_DOMAIN).toBe("example.test");
    expect(env.JWT_SECRET).toBe("secret");
  });
});

