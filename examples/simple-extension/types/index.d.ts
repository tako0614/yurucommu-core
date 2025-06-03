// Unified TypeScript definitions for Takos Extension
// This file exports all context-specific types
// Generated at: 2025-06-04T00:00:00.000Z

// Export common types first
export * from "./common.d.ts";

// Export context-specific types
export * from "./takos-server.d.ts";
export * from "./takos-client.d.ts";
export * from "./takos-ui.d.ts";

// Import context-specific API types
import type { TakosServerAPI } from "./takos-server.d.ts";
import type { TakosClientAPI } from "./takos-client.d.ts";
import type { TakosUIAPI } from "./takos-ui.d.ts";

// Type selection helpers
export type TakosContextAPI<T extends "server" | "client" | "ui"> = T extends
  "server" ? TakosServerAPI
  : T extends "client" ? TakosClientAPI
  : T extends "ui" ? TakosUIAPI
  : never;
