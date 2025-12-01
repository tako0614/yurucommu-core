import { describe, expect, it } from "vitest";
import { createTakosContext } from "./context";
import { loadAppMain } from "./loader";
import { AppSandbox } from "./sandbox";
import { AppHandlerRegistry } from "./registry";
import type { AppLogEntry } from "./types";

describe("App Script runtime", () => {
  it("loads handlers from app-main exports", async () => {
    const module = {
      homeTimeline: () => "home",
      ignored: "not-a-function",
      default: {
        mapQuestionToView: () => "view",
      },
    };

    const loaded = await loadAppMain({ loadModule: async () => module });
    expect(loaded.handlers.sort()).toEqual(["homeTimeline", "mapQuestionToView"]);
    expect(loaded.registry.require("homeTimeline")({} as any)).toBe("home");
    expect(loaded.registry.require("mapQuestionToView")({} as any)).toBe("view");
  });

  it("throws when duplicate handlers are exported", async () => {
    const module = {
      homeTimeline: () => "one",
      default: {
        homeTimeline: () => "two",
      },
    };
    await expect(loadAppMain({ loadModule: async () => module })).rejects.toThrow(
      /Duplicate app handler/,
    );
  });

  it("creates TakosContext with helpers and logging metadata", () => {
    const logs: AppLogEntry[] = [];
    const ctx = createTakosContext({
      mode: "dev",
      workspaceId: "ws_dev",
      runId: "run-ctx",
      handlerName: "homeTimeline",
      auth: { userId: "user-1" },
      services: { posts: { list: () => [] } },
      resolveDb: (name, info) => ({ name, info }),
      resolveStorage: (name, info) => ({ bucket: name, info }),
      logSink: (entry) => {
        logs.push(entry);
      },
    });

    const dbHandle = ctx.db("app:notes") as any;
    expect(dbHandle.name).toBe("app:notes");
    expect(dbHandle.info.mode).toBe("dev");
    expect(dbHandle.info.workspaceId).toBe("ws_dev");

    const storageHandle = ctx.storage("app:assets") as any;
    expect(storageHandle.bucket).toBe("app:assets");

    ctx.log("info", "fetching timeline", { count: 10 });
    expect(logs[0]).toMatchObject({
      handler: "homeTimeline",
      mode: "dev",
      workspaceId: "ws_dev",
      level: "info",
      message: "fetching timeline",
    });

    expect(ctx.json({ ok: true })).toMatchObject({
      type: "json",
      status: 200,
      body: { ok: true },
    });
    expect(ctx.error("bad request")).toMatchObject({
      type: "error",
      status: 400,
      message: "bad request",
    });
    expect(ctx.redirect("/next", 307)).toMatchObject({
      type: "redirect",
      status: 307,
      location: "/next",
    });
  });

  it("runs handlers in sandbox with prod/dev separation and response normalization", async () => {
    const registry = AppHandlerRegistry.fromModule({
      greet: (ctx: any, input: any) => {
        ctx.log("info", "greeting", { input });
        return {
          message: `hello ${input?.name ?? "anon"}`,
          mode: ctx.mode,
          workspace: ctx.workspaceId ?? null,
        };
      },
      crash: () => {
        throw new Error("boom");
      },
    });

    const logs: AppLogEntry[] = [];
    const sandbox = new AppSandbox({
      registry,
      mode: "dev",
      workspaceId: "ws-123",
      logSink: (entry) => {
        logs.push(entry);
      },
      resolveDb: (name, info) => ({ name, info }),
      resolveStorage: (name, info) => ({ bucket: name, info }),
    });

    const result = await sandbox.run("greet", { name: "alice" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.response.type).toBe("json");
      expect((result.response as any).body).toMatchObject({
        message: "hello alice",
        mode: "dev",
        workspace: "ws-123",
      });
    }
    expect(logs.some((entry) => entry.handler === "greet" && entry.runId === result.runId)).toBe(
      true,
    );

    const failure = await sandbox.run("crash");
    expect(failure.ok).toBe(false);
    if (!failure.ok) {
      expect(failure.error.message).toContain("boom");
    }
  });
});
