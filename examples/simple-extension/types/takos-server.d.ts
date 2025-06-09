// filepath: c:\Users\shout\Desktop\temp\takos\examples\simple-extension\types\takos-server.d.ts
// Auto-generated TypeScript definitions for Takos Extension
// DO NOT EDIT MANUALLY
// Generated at: 2025-06-04T00:00:00.000Z

// Import common types
import type {
  EventHandler,
  EventUnsubscribe,
  SerializableArray,
  SerializableObject,
  SerializableValue,
  TakosCdnAPI,
  TakosEvent,
  TakosKVAPI,
} from "./common.d.ts";

// Re-export common types for backward compatibility
export type {
  EventHandler,
  EventUnsubscribe,
  SerializableArray,
  SerializableObject,
  SerializableValue,
  TakosCdnAPI,
  TakosEvent,
  TakosKVAPI,
};

// Server-specific types
export interface TakosServerAPI {
  kv: TakosKVAPI;
  activityPub: {
    send(userId: string, activity: SerializableObject): Promise<void>;
    read(id: string): Promise<SerializableObject>;
    delete(id: string): Promise<void>;
    list(userId?: string): Promise<string[]>;
    actor: {
      read(userId: string): Promise<SerializableObject>;
      update(userId: string, key: string, value: string): Promise<void>;
      delete(userId: string, key: string): Promise<void>;
    };
    pluginActor: {
      create(localName: string, profile: SerializableObject): Promise<string>;
      read(iri: string): Promise<SerializableObject>;
      update(iri: string, partial: SerializableObject): Promise<void>;
      delete(iri: string): Promise<void>;
      list(): Promise<string[]>;
    };
  };
  cdn: TakosCdnAPI;
  events: {
    publish<T = SerializableValue>(name: string, payload: T): Promise<void>;
    subscribe<T = SerializableValue>(
      name: string,
      handler: EventHandler<T>,
    ): EventUnsubscribe;
    unsubscribe(name: string, handler: EventHandler): void;
  };
}
