// Common TypeScript definitions for Takos Extension
// DO NOT EDIT MANUALLY
// Generated at: 2025-06-04T00:00:00.000Z

// Serializable value types for safe communication
export type SerializableValue = 
  | string 
  | number 
  | boolean 
  | null 
  | SerializableObject 
  | SerializableArray;

export interface SerializableObject {
  [key: string]: SerializableValue;
}

export interface SerializableArray extends Array<SerializableValue> {}

// Event types
export interface TakosEvent<T = SerializableValue> {
  name: string;
  payload: T;
  timestamp: number;
  source: 'server' | 'client' | 'ui' | 'background';
}

export type EventHandler<T = SerializableValue> = (payload: T) => void | Promise<void>;
export type EventUnsubscribe = () => void;

// KV API
export interface TakosKVAPI {
  read(key: string): Promise<SerializableValue>;
  write(key: string, value: SerializableValue): Promise<void>;
  delete(key: string): Promise<void>;
  list(): Promise<string[]>;
}

// Assets API
export interface TakosAssetsAPI {
  read(assetId: string): Promise<Uint8Array>;
  write(assetId: string, data: Uint8Array, options?: { cacheTTL?: number }): Promise<void>;
  delete(assetId: string): Promise<void>;
  list(): Promise<string[]>;
}

// Custom project types

// Custom project-specific types can be added here
// These types will be extracted from your project code

export interface CustomEventPayload {
  // Add your custom event payload types here
  [eventName: string]: SerializableValue;
}

export interface CustomActivityPubActivity {
  // Add your custom ActivityPub activity types here
  "@context": string | string[];
  type: string;
  actor: string;
  object?: SerializableValue;
  target?: SerializableValue;
  [key: string]: SerializableValue | undefined;
}
