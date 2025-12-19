import { Hono } from "hono";
import type { PublicAccountBindings as Bindings, Variables } from "@takos/platform/server";
import { HttpError, ok } from "@takos/platform/server";
import { ErrorCodes } from "../lib/error-codes";
import { mapErrorToResponse } from "../lib/observability";
import { createUsageTrackerFromEnv } from "../lib/usage-tracker";

function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function getCurrentDay(): string {
  const now = new Date();
  return now.toISOString().slice(0, 10);
}

function getCurrentMinute(): string {
  const now = new Date();
  return `${getCurrentDay()}-${String(now.getUTCHours()).padStart(2, "0")}${String(now.getUTCMinutes()).padStart(2, "0")}`;
}

function parseTokenList(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  return raw
    .split(/[,\s]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function requireInternalToken(env: Bindings, request: Request): void {
  const expected = [
    ...parseTokenList((env as any).TAKOS_INTERNAL_TOKEN),
    ...parseTokenList((env as any).TAKOS_APP_RPC_TOKEN),
  ];
  if (expected.length === 0) {
    throw new HttpError(503, ErrorCodes.SERVICE_UNAVAILABLE, "Internal token is not configured", {
      envKeys: ["TAKOS_INTERNAL_TOKEN", "TAKOS_APP_RPC_TOKEN"],
    });
  }

  const provided =
    request.headers.get("x-takos-internal-token") ??
    request.headers.get("X-Takos-Internal-Token") ??
    request.headers.get("x-takos-app-rpc-token") ??
    request.headers.get("X-Takos-App-Rpc-Token") ??
    "";

  const token = provided.trim();
  if (!token || !expected.includes(token)) {
    throw new HttpError(403, ErrorCodes.FORBIDDEN, "Invalid internal token");
  }
}

const internalMeteringRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();
internalMeteringRoutes.onError((error, c) =>
  mapErrorToResponse(error, {
    requestId: (c.get("requestId") as string | undefined) ?? undefined,
    env: c.env,
  }),
);

internalMeteringRoutes.get("/-/internal/metering/users/:userId", async (c) => {
  requireInternalToken(c.env as any, c.req.raw);
  const userId = (c.req.param("userId") ?? "").trim();
  if (!userId) {
    throw new HttpError(400, ErrorCodes.INVALID_INPUT, "userId is required");
  }

  const tracker = createUsageTrackerFromEnv(c.env as any);
  const [aiMonthRequests, dmDayMessages, ap] = await Promise.all([
    tracker.getAiUsage(userId),
    tracker.getDmUsage(userId),
    tracker.getApDeliveryUsage(userId),
  ]);

  return ok(c, {
    userId,
    asOf: {
      month: getCurrentMonth(),
      day: getCurrentDay(),
      minute: getCurrentMinute(),
    },
    ai: { monthRequests: aiMonthRequests },
    dm: { dayMessages: dmDayMessages },
    ap: { minuteDeliveries: ap.minute, dayDeliveries: ap.day },
    recordedAt: new Date().toISOString(),
  });
});

export default internalMeteringRoutes;
