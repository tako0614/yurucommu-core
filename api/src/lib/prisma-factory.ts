/// <reference types="@cloudflare/workers-types" />

import type { PrismaClient } from "@prisma/client";

/**
 * Factory function type for creating Prisma clients
 * This allows different implementations to provide their own Prisma setup
 */
export type PrismaClientFactory = (db: D1Database) => PrismaClient;

/**
 * Database initialization configuration
 */
export interface DatabaseConfig {
  DB: D1Database;
  createPrismaClient: PrismaClientFactory;
  instanceDomain?: string;
}
