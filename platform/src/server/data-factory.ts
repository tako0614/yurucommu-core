/// <reference types="@cloudflare/workers-types" />

export type EnvWithDatabase = { DB: D1Database };

type DataFactory = (env: EnvWithDatabase) => any;

let factory: DataFactory | null = null;

/**
 * Register a factory responsible for producing database stores.
 * Consumers must call this during service initialization.
 */
export function setDataFactory(fn: DataFactory): void {
  factory = fn;
}

function assertFactory(): DataFactory {
  if (!factory) {
    throw new Error("Data factory has not been configured. Call setDataFactory() during service startup.");
  }
  return factory;
}

/**
 * Create a database store using the registered factory.
 * Throws if no factory has been registered.
 */
export function makeData<TStore = any>(env: EnvWithDatabase): TStore {
  return assertFactory()(env) as TStore;
}
