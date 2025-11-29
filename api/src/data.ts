// Database API wrapper for takos/backend
// Provides configurable data factories so downstream apps can inject their own DB layer.

/// <reference types="@cloudflare/workers-types" />

import { createDatabaseAPI } from "./lib/data";
import type { DatabaseAPI } from "./lib/types";
import { getPrisma } from "./prisma";
import type {
  AppContext,
  EnvWithDatabase,
  PublicAccountBindings,
} from "@takos/platform/server";
import { requireInstanceDomain } from "@takos/platform/server";

export type DataFactory = (env: EnvWithDatabase) => DatabaseAPI;

let currentFactory: DataFactory = (env) =>
  createDatabaseAPI({
    DB: env.DB,
    createPrismaClient: getPrisma,
    instanceDomain: requireInstanceDomain(env as any),
  });

/**
 * Creates a database API instance for the takos backend.
 * Uses the currently configured factory (defaults to Prisma+D1).
 */
export function makeData(
  env: EnvWithDatabase,
  _context?: AppContext<PublicAccountBindings>,
): DatabaseAPI {
  return currentFactory(env);
}

/**
 * Replace the database factory used by `makeData`.
 */
export function setBackendDataFactory(factory: DataFactory): void {
  currentFactory = factory;
}

/**
 * Returns the built-in data factory (Prisma + Cloudflare D1).
 */
export function getDefaultDataFactory(): DataFactory {
  return (env) =>
    createDatabaseAPI({
      DB: env.DB,
      createPrismaClient: getPrisma,
      instanceDomain: requireInstanceDomain(env as any),
    });
}
