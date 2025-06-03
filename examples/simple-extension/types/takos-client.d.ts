// filepath: c:\Users\shout\Desktop\temp\takos\examples\simple-extension\types\takos-client.d.ts
// Auto-generated TypeScript definitions for Takos Extension
// DO NOT EDIT MANUALLY
// Generated at: 2025-06-04T00:00:00.000Z

// Import common types
import type {
  SerializableValue,
  SerializableObject,
  SerializableArray,
  TakosEvent,
  EventHandler,
  EventUnsubscribe,
  TakosKVAPI,
  TakosAssetsAPI
} from './common.d.ts';

// Re-export common types for backward compatibility
export type {
  SerializableValue,
  SerializableObject,
  SerializableArray,
  TakosEvent,
  EventHandler,
  EventUnsubscribe,
  TakosKVAPI,
  TakosAssetsAPI
};

// Client-specific types
export interface TakosClientAPI {
  kv: TakosKVAPI;
  assets: TakosAssetsAPI;
  events: {
    publish<T = SerializableValue>(name: string, payload: T): Promise<void>;
    subscribe<T = SerializableValue>(name: string, handler: EventHandler<T>): EventUnsubscribe;
    unsubscribe(name: string, handler: EventHandler): void;
  };
}

// GlobalThis type extension for client context
export interface GlobalThisWithClientTakos {
  takos: TakosClientAPI | undefined;
}
