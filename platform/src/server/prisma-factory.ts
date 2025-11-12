/// <reference types="@cloudflare/workers-types" />

export type PrismaEnv = { DB: D1Database };
type PrismaFactory = (env: PrismaEnv) => any;

let factory: PrismaFactory | null = null;

/**
 * Register a factory that creates Prisma clients bound to the current request/env.
 * Must be called by the consuming service during initialization.
 */
export function setPrismaFactory(fn: PrismaFactory): void {
  factory = fn;
}

function assertFactory(): PrismaFactory {
  if (!factory) {
    throw new Error("Prisma factory has not been configured. Call setPrismaFactory() before using Prisma helpers.");
  }
  return factory;
}

/**
 * Create a Prisma client using the registered factory.
 */
export function getPrismaClient<TClient = any>(env: PrismaEnv): TClient {
  return assertFactory()(env) as TClient;
}
