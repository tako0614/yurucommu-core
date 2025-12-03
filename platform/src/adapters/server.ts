/**
 * Server Factory for Different Runtimes
 *
 * Provides a unified way to create and run a takos server
 * on different runtimes (Cloudflare Workers, Node.js, etc.)
 */

import type { RuntimeAdapter, RuntimeType } from "./index";
import { detectRuntime } from "./index";
import { NodeAdapter, type NodeAdapterConfig } from "./node";
import { CloudflareAdapter, type CloudflareBindings } from "./cloudflare";
import type { Hono } from "hono";

export interface ServerConfig {
  port?: number;
  hostname?: string;
  instanceDomain: string;
}

export interface TakosServerOptions {
  runtime?: RuntimeType;
  cloudflare?: CloudflareBindings;
  node?: NodeAdapterConfig;
  server?: ServerConfig;
}

export class TakosServer {
  private adapter: RuntimeAdapter;
  private app: Hono<any> | null = null;
  private config: ServerConfig;

  constructor(options: TakosServerOptions) {
    const runtime = options.runtime || detectRuntime();
    this.config = options.server || { instanceDomain: "localhost" };

    switch (runtime) {
      case "cloudflare-workers":
        if (!options.cloudflare) {
          throw new Error("Cloudflare bindings required for Cloudflare Workers runtime");
        }
        this.adapter = new CloudflareAdapter(options.cloudflare);
        break;

      case "node":
      case "bun":
      case "deno":
        this.adapter = new NodeAdapter(options.node);
        break;

      default:
        throw new Error(`Unsupported runtime: ${runtime}`);
    }
  }

  getAdapter(): RuntimeAdapter {
    return this.adapter;
  }

  getInstanceDomain(): string {
    return this.config.instanceDomain;
  }

  /**
   * Initialize the server (required for Node.js adapter)
   */
  async initialize(): Promise<void> {
    if (this.adapter.name === "node" && "initialize" in this.adapter) {
      await (this.adapter as NodeAdapter).initialize();
    }
  }

  /**
   * Create the Hono application with the runtime adapter.
   * This allows the app to use the appropriate storage/database implementations.
   */
  async createApp(): Promise<Hono<any>> {
    if (this.app) return this.app;

    await this.initialize();

    // Dynamic import to avoid circular dependencies
    const { createTakosApp } = await import("../../../api/src/index");

    // Create bindings-like object from adapter
    const env = this.createEnvFromAdapter();

    this.app = createTakosApp({ instanceDomain: this.config.instanceDomain }, this.config.instanceDomain);
    return this.app;
  }

  /**
   * Create an environment object compatible with the existing API
   */
  private createEnvFromAdapter(): Record<string, unknown> {
    const adapter = this.adapter;

    return {
      // Database binding (will be wrapped by the adapter)
      DB: {
        prepare: (sql: string) => ({
          bind: (...params: unknown[]) => ({
            all: async () => {
              const result = await adapter.database.execute(sql, params);
              return { results: result.results, meta: result.meta };
            },
            first: async () => {
              const result = await adapter.database.execute(sql, params);
              return result.results[0] || null;
            },
            run: async () => {
              const result = await adapter.database.execute(sql, params);
              return { meta: result.meta };
            },
          }),
          all: async () => {
            const result = await adapter.database.execute(sql);
            return { results: result.results, meta: result.meta };
          },
          first: async () => {
            const result = await adapter.database.execute(sql);
            return result.results[0] || null;
          },
          run: async () => {
            const result = await adapter.database.execute(sql);
            return { meta: result.meta };
          },
        }),
        batch: async (statements: { sql: string; params?: unknown[] }[]) => {
          return adapter.database.batch(statements);
        },
      },

      // Media storage binding
      MEDIA: {
        get: async (key: string) => adapter.storage.get(key),
        put: async (
          key: string,
          body: ReadableStream | ArrayBuffer | string | Blob,
          options?: { httpMetadata?: { contentType?: string; cacheControl?: string } }
        ) => adapter.storage.put(key, body, options),
        delete: async (key: string) => adapter.storage.delete(key),
        list: async (options?: { prefix?: string; delimiter?: string; cursor?: string }) =>
          adapter.storage.list(options),
      },

      // KV binding
      KV: {
        get: async (key: string) => adapter.kv.get(key),
        put: async (key: string, value: string, options?: { expirationTtl?: number }) =>
          adapter.kv.put(key, value, options),
        delete: async (key: string) => adapter.kv.delete(key),
        list: async (options?: { prefix?: string; limit?: number; cursor?: string }) =>
          adapter.kv.list(options),
      },

      // Environment variables
      INSTANCE_DOMAIN: this.config.instanceDomain,
      AUTH_PASSWORD: adapter.getEnv("AUTH_PASSWORD"),
      SESSION_COOKIE_NAME: adapter.getEnv("SESSION_COOKIE_NAME"),
      SESSION_TTL_HOURS: adapter.getEnv("SESSION_TTL_HOURS"),
      ACTIVITYPUB_ENABLED: adapter.getEnv("ACTIVITYPUB_ENABLED") || "true",
      TAKOS_CONTEXT: adapter.getEnv("TAKOS_CONTEXT") || (adapter.isProduction() ? "prod" : "dev"),
    };
  }

  /**
   * Start the server (Node.js only)
   * For Cloudflare Workers, export the app and use the built-in fetch handler.
   */
  async listen(callback?: () => void): Promise<void> {
    if (this.adapter.name === "cloudflare-workers") {
      throw new Error(
        "listen() is not available for Cloudflare Workers. " +
        "Export the app and use the default export instead."
      );
    }

    const app = await this.createApp();
    const port = this.config.port || 8787;
    const hostname = this.config.hostname || "0.0.0.0";

    // Use Node.js serve adapter
    const { serve } = await import("@hono/node-server");
    serve({
      fetch: app.fetch,
      port,
      hostname,
    }, () => {
      if (callback) {
        callback();
      } else {
        console.log(`[takos] Server running at http://${hostname}:${port}`);
      }
    });
  }
}

/**
 * Create a takos server for the current runtime
 */
export function createServer(options: TakosServerOptions): TakosServer {
  return new TakosServer(options);
}

/**
 * Quick start for Node.js
 */
export async function startNodeServer(config: {
  instanceDomain: string;
  port?: number;
  databasePath?: string;
  storagePath?: string;
  env?: Record<string, string | undefined>;
}): Promise<TakosServer> {
  const server = createServer({
    runtime: "node",
    node: {
      databasePath: config.databasePath,
      storagePath: config.storagePath,
      env: config.env,
    },
    server: {
      instanceDomain: config.instanceDomain,
      port: config.port,
    },
  });

  await server.listen();
  return server;
}
