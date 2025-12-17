import { describe, expect, it } from "vitest";
import coreRecoveryRoutes from "./core-recovery";

const basic = (username: string, password: string) =>
  `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;

describe("Core Recovery UI HTML", () => {
  it("includes pending config UI and does not reference legacy ok() shape", async () => {
    const env: any = {
      AUTH_USERNAME: "owner",
      AUTH_PASSWORD: "pass",
    };

    const res = await coreRecoveryRoutes.fetch(
      new Request("http://takos.internal/-/core/", {
        method: "GET",
        headers: { authorization: basic("owner", "pass") },
      }),
      env,
      {} as any,
    );

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("/-/config/pending");
    expect(html).toContain("unwrapOkJson");
    expect(html).not.toContain("data.result");
  });
});

