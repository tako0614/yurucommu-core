import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJWT } from "@takos/platform/server";
import appDebug from "./app-debug";
import { getDefaultDataFactory, setBackendDataFactory } from "../data";
import type { AppLogEntry } from "@takos/platform/app";

const authEnv = { AUTH_USERNAME: "admin", AUTH_PASSWORD: "secret" };
const bearer = (token: string) => `Bearer ${token}`;

describe("app debug routes", () => {
  const defaultFactory = getDefaultDataFactory();
  const sharedLogs: AppLogEntry[] = [];
  const secret = "jwt-secret";
  let lastLogQuery: any = null;

  const dataFactory = () =>
    ({
      getUser: async (id: string) => ({ id }),
      getUserJwtSecret: async () => secret,
      setUserJwtSecret: async () => {},
      appendAppLogEntries: async (entries: AppLogEntry[]) => {
        sharedLogs.push(...entries);
      },
      listAppLogEntries: async (options?: any) => {
        lastLogQuery = options;
        return sharedLogs;
      },
      disconnect: async () => {},
    }) as any;

  beforeEach(() => {
    sharedLogs.length = 0;
    lastLogQuery = null;
    setBackendDataFactory(() => dataFactory());
  });

  afterEach(() => {
    setBackendDataFactory(defaultFactory);
  });

  it("runs a handler in dev sandbox and persists logs", async () => {
    const token = await createJWT("admin", secret, 3600);
    const res = await appDebug.request(
      "/admin/app/debug/run",
      {
        method: "POST",
        headers: {
          Authorization: bearer(token),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          mode: "dev",
          workspaceId: "ws_demo",
          handler: "ping",
          input: { hello: "world" },
        }),
      },
      authEnv,
    );

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.ok).toBe(true);
    expect(json.handler).toBe("ping");
    expect(Array.isArray(json.logs)).toBe(true);
    expect(sharedLogs.length).toBeGreaterThan(0);
    const runIds = new Set(sharedLogs.map((log) => log.runId));
    expect(runIds.size).toBe(1);
    expect(sharedLogs.some((log) => log.workspaceId === "ws_demo")).toBe(true);
  });

  it("returns stored logs with filters applied", async () => {
    sharedLogs.push(
      {
        timestamp: new Date().toISOString(),
        mode: "dev",
        workspaceId: "ws_demo",
        runId: "run-test",
        handler: "ping",
        level: "info",
        message: "hello",
      },
      {
        timestamp: new Date().toISOString(),
        mode: "prod",
        runId: "run-prod",
        handler: "ping",
        level: "info",
        message: "prod log",
      },
    );
    const token = await createJWT("admin", secret, 3600);
    const res = await appDebug.request(
      "/admin/app/debug/logs?workspaceId=ws_demo&handler=ping&mode=dev",
      {
        method: "GET",
        headers: { Authorization: bearer(token) },
      },
      authEnv,
    );

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.ok).toBe(true);
    expect(Array.isArray(json.logs)).toBe(true);
    expect(json.logs.length).toBeGreaterThan(0);
    expect(lastLogQuery?.workspaceId).toBe("ws_demo");
    expect(lastLogQuery?.handler).toBe("ping");
    expect(lastLogQuery?.mode).toBe("dev");
  });
});
