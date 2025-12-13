/**
 * Sample Counter App (TakosApp.fetch style)
 *
 * A simple counter app demonstrating the App SDK fetch handler pattern.
 */

import { json, error, parseBody } from "@takos/app-sdk/server";
import type { TakosApp, AppEnv } from "@takos/app-sdk/server";

interface CounterState {
  value: number;
  lastUpdated: string;
}

const COUNTER_KEY = "counter";

function requireAuth(env: AppEnv): Response | null {
  if (!env.auth) {
    return error("Authentication required", 401);
  }
  return null;
}

async function readBody(request: Request): Promise<Record<string, any>> {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      return await parseBody<Record<string, any>>(request);
    } catch {
      return {};
    }
  }
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const text = await request.text();
    return Object.fromEntries(new URLSearchParams(text));
  }
  return {};
}

const app: TakosApp = {
  async fetch(request: Request, env: AppEnv): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";

    // Public info endpoint (no auth required)
    if (request.method === "GET" && path === "/info") {
      return json({
        id: "sample-counter",
        name: "Sample Counter",
        version: "1.0.0",
        description: "A simple counter app demonstrating the App SDK",
      });
    }

    // Counter endpoints (auth required)
    if (path.startsWith("/counter")) {
      const authError = requireAuth(env);
      if (authError) return authError;

      // GET /counter
      if (request.method === "GET" && path === "/counter") {
        const state = await env.storage.get<CounterState>(COUNTER_KEY);
        return json({
          value: state?.value ?? 0,
          lastUpdated: state?.lastUpdated ?? null,
        });
      }

      if (request.method === "POST") {
        const input = await readBody(request);
        const state = await env.storage.get<CounterState>(COUNTER_KEY);
        const currentValue = state?.value ?? 0;
        const lastUpdated = new Date().toISOString();

        // POST /counter/increment
        if (path === "/counter/increment") {
          const amount = Number(input.amount ?? 1);
          const newValue = currentValue + amount;
          await env.storage.set(COUNTER_KEY, { value: newValue, lastUpdated });
          return json({ value: newValue, previousValue: currentValue, lastUpdated });
        }

        // POST /counter/decrement
        if (path === "/counter/decrement") {
          const amount = Number(input.amount ?? 1);
          const newValue = currentValue - amount;
          await env.storage.set(COUNTER_KEY, { value: newValue, lastUpdated });
          return json({ value: newValue, previousValue: currentValue, lastUpdated });
        }

        // POST /counter/reset
        if (path === "/counter/reset") {
          await env.storage.set(COUNTER_KEY, { value: 0, lastUpdated });
          return json({ value: 0, previousValue: currentValue, lastUpdated });
        }

        // POST /counter/set
        if (path === "/counter/set") {
          if (input.value === undefined) {
            return error("value is required", 400);
          }
          const newValue = Number(input.value);
          await env.storage.set(COUNTER_KEY, { value: newValue, lastUpdated });
          return json({ value: newValue, previousValue: currentValue, lastUpdated });
        }
      }
    }

    return error("Handler not found", 404);
  },
};

export default app;
