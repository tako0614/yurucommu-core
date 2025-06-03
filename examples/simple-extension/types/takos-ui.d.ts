// filepath: c:\Users\shout\Desktop\temp\takos\examples\simple-extension\types\takos-ui.d.ts
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
  TakosEvent,
} from "./common.d.ts";

// Re-export common types for backward compatibility
export type {
  EventHandler,
  EventUnsubscribe,
  SerializableArray,
  SerializableObject,
  SerializableValue,
  TakosEvent,
};

// UI-specific types
export interface TakosUIAPI {
  events: {
    publish<T = SerializableValue>(name: string, payload: T): Promise<void>;
    subscribe<T = SerializableValue>(
      name: string,
      handler: EventHandler<T>,
    ): EventUnsubscribe;
    unsubscribe(name: string, handler: EventHandler): void;
  };
}

// GlobalThis type extension for ui context
export interface GlobalThisWithUITakos {
  takos: TakosUIAPI | undefined;
}
