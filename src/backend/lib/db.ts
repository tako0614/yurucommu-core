/**
 * Database Utility Module
 *
 * Provides a unified Prisma client that works across multiple runtimes:
 * - Cloudflare Workers (D1)
 * - Node.js (better-sqlite3)
 * - Bun (native SQLite)
 *
 * Uses Prisma's driver adapter feature for runtime-specific connections.
 */

import { PrismaClient } from '../../generated/prisma';
import { PrismaD1 } from '@prisma/adapter-d1';
import type { D1Database } from '@cloudflare/workers-types';

// Singleton instance for non-Cloudflare runtimes
let prismaClient: PrismaClient | null = null;
function withDeletedAtFilter<TArgs extends { where?: unknown }>(args: TArgs): TArgs {
  const where = (args.where ?? {}) as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(where, 'deletedAt')) {
    return args;
  }

  return {
    ...args,
    where: {
      AND: [where, { deletedAt: null }],
    },
  };
}

const SOFT_DELETE_METHODS = [
  'findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany', 'count',
] as const;

function buildSoftDeleteHandlers(): Record<string, (ctx: { args: unknown; query: (args: unknown) => unknown }) => unknown> {
  const handlers: Record<string, (ctx: { args: unknown; query: (args: unknown) => unknown }) => unknown> = {};
  for (const method of SOFT_DELETE_METHODS) {
    handlers[method] = ({ args, query }) =>
      query(withDeletedAtFilter(args as { where?: unknown }) as typeof args);
  }
  return handlers;
}

const softDeleteHandlers = buildSoftDeleteHandlers();

function withSoftDeleteMiddleware(prisma: PrismaClient): PrismaClient {
  return prisma.$extends({
    query: {
      actor: softDeleteHandlers,
      object: softDeleteHandlers,
      community: softDeleteHandlers,
    },
  }) as PrismaClient;
}

/**
 * Get or create a Prisma client for Cloudflare D1
 */
export function getPrismaD1(d1: D1Database): PrismaClient {
  const adapter = new PrismaD1(d1);
  return withSoftDeleteMiddleware(new PrismaClient({ adapter }));
}

/**
 * Get or create a Prisma client for Node.js/Bun with SQLite file
 */
export async function getPrismaSQLite(databasePath: string): Promise<PrismaClient> {
  if (prismaClient) {
    return prismaClient;
  }

  const { PrismaLibSql } = await import('@prisma/adapter-libsql');

  const adapter = new PrismaLibSql({
    url: `file:${databasePath}`,
  });
  prismaClient = withSoftDeleteMiddleware(new PrismaClient({ adapter }));

  return prismaClient;
}

/**
 * Get Prisma client based on environment
 * For Cloudflare Workers, pass the D1 binding
 * For other runtimes, pass the database path
 */
export function createPrismaClient(
  options: { d1: D1Database } | { databasePath: string }
): PrismaClient | Promise<PrismaClient> {
  if ('d1' in options) {
    return getPrismaD1(options.d1);
  }
  return getPrismaSQLite(options.databasePath);
}

/**
 * Disconnect Prisma client (for cleanup)
 */
export async function disconnectPrisma(): Promise<void> {
  if (prismaClient) {
    await prismaClient.$disconnect();
    prismaClient = null;
  }
}

export { PrismaClient };
export type * from '../../generated/prisma';
