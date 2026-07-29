import { expect, test } from "bun:test";

import {
  createManagedRuntimeKeyValueStore,
  createManagedRuntimeObjectStorage,
  type IKeyValueStore,
  type IObjectStorage,
  type ManagedRuntimeDataAdapterOptions,
} from "../public.ts";
import {
  createManagedRuntimeKeyValueStore as createManagedRuntimeKeyValueStoreDirect,
  createManagedRuntimeObjectStorage as createManagedRuntimeObjectStorageDirect,
} from "../runtime/managed-runtime.ts";

test("server public surface exports the managed data adapters and their contracts", () => {
  const keyValueFactory: (
    options: ManagedRuntimeDataAdapterOptions,
  ) => IKeyValueStore = createManagedRuntimeKeyValueStore;
  const objectStorageFactory: (
    options: ManagedRuntimeDataAdapterOptions,
  ) => IObjectStorage = createManagedRuntimeObjectStorage;

  expect(keyValueFactory).toBe(createManagedRuntimeKeyValueStoreDirect);
  expect(objectStorageFactory).toBe(createManagedRuntimeObjectStorageDirect);
});
