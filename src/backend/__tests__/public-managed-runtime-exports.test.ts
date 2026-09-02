import { expect, test } from "bun:test";

import {
  createManagedRuntimeKeyValueStore,
  createManagedRuntimeObjectStorage,
  type IKeyValueStore,
  type ObjectStore,
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
  ) => ObjectStore = createManagedRuntimeObjectStorage;

  expect(keyValueFactory).toBe(createManagedRuntimeKeyValueStoreDirect);
  expect(objectStorageFactory).toBe(createManagedRuntimeObjectStorageDirect);
});

test("server public object-store exports do not carry the removed vendor shape", async () => {
  const publicSource = await Bun.file(
    new URL("../public.ts", import.meta.url),
  ).text();
  const typesSource = await Bun.file(
    new URL("../runtime/types.ts", import.meta.url),
  ).text();
  for (const source of [publicSource, typesSource]) {
    expect(source).not.toMatch(
      /\bR2\b|IObjectStorage|ObjectMetadata|StorageObject|ListObjectsResult/u,
    );
  }
});
