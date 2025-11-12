// src/prisma.ts
/// <reference types="@cloudflare/workers-types" />
import { PrismaClient } from "@prisma/client";
import { PrismaD1 } from "@prisma/adapter-d1";

/**
 * Creates a Prisma client with D1 adapter
 * This function is injected into the core database API
 */
export function getPrisma(db: D1Database) {
  if (!db) throw new Error("D1 database is required for Prisma");
  // For Cloudflare Workers: do NOT cache a PrismaClient created with a request-scoped
  // D1 adapter across requests. Create a fresh adapter (and client) per request to
  // avoid cross-request promise resolution errors and potential hung requests.
  const adapter = new PrismaD1(db);
  return new PrismaClient({ adapter });
}
