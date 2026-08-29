import {
  TAKOSUMI_MANAGED_RUNTIME_INVOKE_PERMISSION,
  managedRuntimeConnection,
  managedRuntimeGatewayFailure,
  managedRuntimeKeyValueListRequest,
  managedRuntimeKeyValueRequest,
  managedRuntimeObjectListRequest,
  managedRuntimeObjectRequest,
  managedRuntimeQueueBatchSendGatewayRequest,
  managedRuntimeQueueSendGatewayRequest,
  parseManagedRuntimeKeyValueListResponse,
  parseManagedRuntimeObjectListResponse,
  parseManagedRuntimeConnectionMaterialization,
  parseManagedRuntimeQueueSendResponse,
  type ManagedRuntimeConnectionMaterialization,
} from "@takosjp/takosumi-contract/managed-runtime-connections";

import type {
  IKeyValueStore,
  IObjectStorage,
  ListObjectsResult,
  ObjectMetadata,
  StorageObject,
} from "./types.ts";
import type {
  IQueueProducer,
  QueueBatchItem,
  QueueSendOptions,
} from "./queue.ts";

const DEFAULT_MAX_GATEWAY_RESPONSE_BYTES = 16 * 1024;
const DEFAULT_MAX_VALUE_RESPONSE_BYTES = 25 * 1024 * 1024;
const DEFAULT_MAX_OBJECT_RESPONSE_BYTES = 16 * 1024 * 1024;

export interface ManagedRuntimeGateway {
  fetch(request: Request): Promise<Response>;
}

export class ManagedRuntimeGatewayError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = "ManagedRuntimeGatewayError";
  }
}

export interface ManagedRuntimeQueueProducerOptions {
  readonly materialization: unknown;
  readonly gateway: ManagedRuntimeGateway;
  readonly alias: string;
  readonly idempotencyKey?: () => string;
  readonly maxResponseBytes?: number;
}

export interface ManagedRuntimeDataAdapterOptions {
  readonly materialization: unknown;
  readonly gateway: ManagedRuntimeGateway;
  readonly alias: string;
  readonly idempotencyKey?: () => string;
  readonly maxMetadataResponseBytes?: number;
  readonly maxValueResponseBytes?: number;
}

export function createManagedRuntimeKeyValueStore(
  options: ManagedRuntimeDataAdapterOptions,
): IKeyValueStore {
  const materialization = parseManagedRuntimeConnectionMaterialization(
    options.materialization,
  );
  const connection = managedRuntimeConnection(materialization, options.alias, {
    expectedKind: "KeyValueStore",
    requiredPermission: TAKOSUMI_MANAGED_RUNTIME_INVOKE_PERMISSION,
  });
  return new ManagedRuntimeKeyValueStore({
    authority: connection.authority,
    gateway: options.gateway,
    idempotencyKey:
      options.idempotencyKey ?? (() => `yurucommu.kv:${crypto.randomUUID()}`),
    maxMetadataResponseBytes:
      options.maxMetadataResponseBytes ?? DEFAULT_MAX_GATEWAY_RESPONSE_BYTES,
    maxValueResponseBytes:
      options.maxValueResponseBytes ?? DEFAULT_MAX_VALUE_RESPONSE_BYTES,
  });
}

export function createManagedRuntimeObjectStorage(
  options: ManagedRuntimeDataAdapterOptions,
): IObjectStorage {
  const materialization = parseManagedRuntimeConnectionMaterialization(
    options.materialization,
  );
  const connection = managedRuntimeConnection(materialization, options.alias, {
    expectedKind: "ObjectBucket",
    requiredPermission: TAKOSUMI_MANAGED_RUNTIME_INVOKE_PERMISSION,
  });
  return new ManagedRuntimeObjectStorage({
    authority: connection.authority,
    gateway: options.gateway,
    idempotencyKey:
      options.idempotencyKey ??
      (() => `yurucommu.object:${crypto.randomUUID()}`),
    maxMetadataResponseBytes:
      options.maxMetadataResponseBytes ?? DEFAULT_MAX_GATEWAY_RESPONSE_BYTES,
    maxValueResponseBytes:
      options.maxValueResponseBytes ?? DEFAULT_MAX_OBJECT_RESPONSE_BYTES,
  });
}

/**
 * Creates the queue producer selected by an exact host-issued materialization.
 *
 * The materialization and Fetch-compatible gateway are injected separately:
 * portable application configuration never contains provider ids or bearer
 * credentials, and a managed selection never falls back to native bindings.
 */
export function createManagedRuntimeQueueProducer<T>(
  options: ManagedRuntimeQueueProducerOptions,
): IQueueProducer<T> {
  const materialization = parseManagedRuntimeConnectionMaterialization(
    options.materialization,
  );
  const connection = managedRuntimeConnection(materialization, options.alias, {
    expectedKind: "Queue",
    requiredPermission: TAKOSUMI_MANAGED_RUNTIME_INVOKE_PERMISSION,
  });
  return new ManagedRuntimeQueueProducer<T>({
    materialization,
    authority: connection.authority,
    gateway: options.gateway,
    idempotencyKey:
      options.idempotencyKey ??
      (() => `yurucommu.queue:${crypto.randomUUID()}`),
    maxResponseBytes:
      options.maxResponseBytes ?? DEFAULT_MAX_GATEWAY_RESPONSE_BYTES,
  });
}

class ManagedRuntimeQueueProducer<T> implements IQueueProducer<T> {
  constructor(
    private readonly options: {
      readonly materialization: ManagedRuntimeConnectionMaterialization;
      readonly authority: ManagedRuntimeConnectionMaterialization["connections"][number]["authority"];
      readonly gateway: ManagedRuntimeGateway;
      readonly idempotencyKey: () => string;
      readonly maxResponseBytes: number;
    },
  ) {
    if (
      !Number.isSafeInteger(options.maxResponseBytes) ||
      options.maxResponseBytes < 1
    ) {
      throw new TypeError("managed_runtime_response_limit_invalid");
    }
  }

  async send(body: T, options?: QueueSendOptions): Promise<void> {
    const request = managedRuntimeQueueSendGatewayRequest(
      this.options.authority,
      {
        message: { type: "json", body },
        ...(options?.delaySeconds === undefined
          ? {}
          : { delaySeconds: options.delaySeconds }),
      },
      this.options.idempotencyKey(),
    );
    await this.sendRequest(request);
  }

  async sendBatch(
    messages: readonly QueueBatchItem<T>[],
    options?: QueueSendOptions,
  ): Promise<void> {
    const request = managedRuntimeQueueBatchSendGatewayRequest(
      this.options.authority,
      {
        messages: messages.map(({ body, delaySeconds }) => ({
          message: { type: "json" as const, body },
          ...(delaySeconds === undefined ? {} : { delaySeconds }),
        })),
        ...(options?.delaySeconds === undefined
          ? {}
          : { defaultDelaySeconds: options.delaySeconds }),
      },
      this.options.idempotencyKey(),
    );
    await this.sendRequest(request);
  }

  private async sendRequest(request: Request): Promise<void> {
    const response = await boundedResponse(
      await this.options.gateway.fetch(request),
      this.options.maxResponseBytes,
    );
    const failure = await managedRuntimeGatewayFailure(response.clone());
    if (failure) {
      throw new ManagedRuntimeGatewayError(
        failure.code,
        failure.status,
        failure.retryable,
      );
    }
    parseManagedRuntimeQueueSendResponse(await response.json());
  }
}

type ManagedRuntimeAuthority =
  ManagedRuntimeConnectionMaterialization["connections"][number]["authority"];

type ManagedRuntimeDataClientOptions = {
  readonly authority: ManagedRuntimeAuthority;
  readonly gateway: ManagedRuntimeGateway;
  readonly idempotencyKey: () => string;
  readonly maxMetadataResponseBytes: number;
  readonly maxValueResponseBytes: number;
};

class ManagedRuntimeKeyValueStore implements IKeyValueStore {
  constructor(private readonly options: ManagedRuntimeDataClientOptions) {
    assertResponseLimit(options.maxMetadataResponseBytes);
    assertResponseLimit(options.maxValueResponseBytes);
  }

  get(key: string, options?: { type?: "text" }): Promise<string | null>;
  get<T = unknown>(key: string, options: { type: "json" }): Promise<T | null>;
  get(
    key: string,
    options: { type: "arrayBuffer" },
  ): Promise<ArrayBuffer | null>;
  async get<T = unknown>(
    key: string,
    options?: { type?: "text" | "json" | "arrayBuffer" },
  ): Promise<string | ArrayBuffer | T | null> {
    const request = managedRuntimeKeyValueRequest(this.options.authority, {
      method: "GET",
      key,
      idempotencyKey: this.options.idempotencyKey(),
    });
    const raw = await this.options.gateway.fetch(request);
    if (raw.status === 404) {
      await raw.body?.cancel().catch(() => undefined);
      return null;
    }
    const response = await checkedResponse(
      raw,
      this.options.maxValueResponseBytes,
    );
    const type = options?.type ?? "text";
    if (type === "arrayBuffer") return await response.arrayBuffer();
    if (type === "json") {
      try {
        return JSON.parse(await response.text()) as T;
      } catch {
        throw new ManagedRuntimeGatewayError(
          "managed_runtime_kv_json_invalid",
          502,
          false,
        );
      }
    }
    return await response.text();
  }

  async put(
    key: string,
    value: string | ArrayBuffer | ReadableStream,
    options?: {
      expirationTtl?: number;
      expiration?: number;
      metadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    const request = managedRuntimeKeyValueRequest(this.options.authority, {
      method: "PUT",
      key,
      idempotencyKey: this.options.idempotencyKey(),
      value: value as BodyInit,
      ...(options === undefined ? {} : { options }),
    });
    await expectOkResponse(
      await this.options.gateway.fetch(request),
      this.options.maxMetadataResponseBytes,
    );
  }

  async delete(key: string): Promise<void> {
    const request = managedRuntimeKeyValueRequest(this.options.authority, {
      method: "DELETE",
      key,
      idempotencyKey: this.options.idempotencyKey(),
    });
    await expectOkResponse(
      await this.options.gateway.fetch(request),
      this.options.maxMetadataResponseBytes,
    );
  }

  async list(options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{
    keys: Array<{ name: string; expiration?: number; metadata?: unknown }>;
    list_complete: boolean;
    cursor?: string;
  }> {
    const request = managedRuntimeKeyValueListRequest(this.options.authority, {
      idempotencyKey: this.options.idempotencyKey(),
      ...options,
    });
    const response = await checkedResponse(
      await this.options.gateway.fetch(request),
      this.options.maxMetadataResponseBytes,
    );
    const parsed = parseManagedRuntimeKeyValueListResponse(
      await response.json(),
    );
    return {
      keys: [...parsed.keys],
      list_complete: parsed.cursor === undefined,
      ...(parsed.cursor === undefined ? {} : { cursor: parsed.cursor }),
    };
  }
}

class ManagedRuntimeObjectStorage implements IObjectStorage {
  constructor(private readonly options: ManagedRuntimeDataClientOptions) {
    assertResponseLimit(options.maxMetadataResponseBytes);
    assertResponseLimit(options.maxValueResponseBytes);
  }

  async put(
    key: string,
    value: Blob | ReadableStream | ArrayBuffer | string,
    options?: {
      httpMetadata?: ObjectMetadata["httpMetadata"];
      customMetadata?: Record<string, string>;
    },
  ): Promise<void> {
    const request = managedRuntimeObjectRequest(this.options.authority, {
      method: "PUT",
      key,
      idempotencyKey: this.options.idempotencyKey(),
      value: value as BodyInit,
      ...(options?.httpMetadata === undefined
        ? {}
        : { httpMetadata: options.httpMetadata }),
      ...(options?.customMetadata === undefined
        ? {}
        : { customMetadata: options.customMetadata }),
    });
    await expectOkResponse(
      await this.options.gateway.fetch(request),
      this.options.maxMetadataResponseBytes,
    );
  }

  async get(key: string): Promise<StorageObject | null> {
    const request = managedRuntimeObjectRequest(this.options.authority, {
      method: "GET",
      key,
      idempotencyKey: this.options.idempotencyKey(),
    });
    const raw = await this.options.gateway.fetch(request);
    if (raw.status === 404) {
      await raw.body?.cancel().catch(() => undefined);
      return null;
    }
    return new ManagedRuntimeStorageObject(
      key,
      await checkedResponse(raw, this.options.maxValueResponseBytes),
    );
  }

  async delete(key: string | string[]): Promise<void> {
    for (const entry of Array.isArray(key) ? key : [key]) {
      const request = managedRuntimeObjectRequest(this.options.authority, {
        method: "DELETE",
        key: entry,
        idempotencyKey: this.options.idempotencyKey(),
      });
      await expectOkResponse(
        await this.options.gateway.fetch(request),
        this.options.maxMetadataResponseBytes,
      );
    }
  }

  async list(options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
    delimiter?: string;
  }): Promise<ListObjectsResult> {
    const request = managedRuntimeObjectListRequest(this.options.authority, {
      idempotencyKey: this.options.idempotencyKey(),
      ...options,
    });
    const response = await checkedResponse(
      await this.options.gateway.fetch(request),
      this.options.maxMetadataResponseBytes,
    );
    const parsed = parseManagedRuntimeObjectListResponse(await response.json());
    return {
      objects: parsed.objects.map((entry) => ({
        key: entry.key,
        size: entry.size,
        uploaded: new Date(entry.uploaded),
        ...(entry.etag === undefined ? {} : { etag: entry.etag }),
      })),
      truncated: parsed.truncated,
      ...(parsed.cursor === undefined ? {} : { cursor: parsed.cursor }),
      ...(parsed.delimitedPrefixes === undefined
        ? {}
        : { delimitedPrefixes: [...parsed.delimitedPrefixes] }),
    };
  }

  async head(key: string): Promise<ObjectMetadata | null> {
    const request = managedRuntimeObjectRequest(this.options.authority, {
      method: "HEAD",
      key,
      idempotencyKey: this.options.idempotencyKey(),
    });
    const raw = await this.options.gateway.fetch(request);
    if (raw.status === 404) {
      await raw.body?.cancel().catch(() => undefined);
      return null;
    }
    const response = await checkedResponse(
      raw,
      this.options.maxMetadataResponseBytes,
    );
    return objectMetadata(response.headers);
  }
}

class ManagedRuntimeStorageObject implements StorageObject {
  constructor(
    readonly key: string,
    private readonly response: Response,
  ) {}

  get body(): ReadableStream | null {
    return this.response.body;
  }

  get bodyUsed(): boolean {
    return this.response.bodyUsed;
  }

  get httpEtag(): string | undefined {
    return this.response.headers.get("etag") ?? undefined;
  }

  get httpMetadata(): ObjectMetadata["httpMetadata"] {
    return objectMetadata(this.response.headers).httpMetadata;
  }

  get customMetadata(): Record<string, string> | undefined {
    return objectMetadata(this.response.headers).customMetadata;
  }

  arrayBuffer(): Promise<ArrayBuffer> {
    return this.response.arrayBuffer();
  }

  text(): Promise<string> {
    return this.response.text();
  }

  async json<T = unknown>(): Promise<T> {
    return (await this.response.json()) as T;
  }
}

function objectMetadata(headers: Headers): ObjectMetadata {
  const contentLength = headers.get("content-length");
  const custom = headers.get("x-takosumi-object-custom-metadata");
  let customMetadata: Record<string, string> | undefined;
  if (custom !== null) {
    try {
      const decoded = JSON.parse(decodeURIComponent(custom)) as unknown;
      if (
        decoded === null ||
        typeof decoded !== "object" ||
        Array.isArray(decoded) ||
        Object.values(decoded).some((value) => typeof value !== "string")
      ) {
        throw new Error("invalid");
      }
      customMetadata = decoded as Record<string, string>;
    } catch {
      throw new ManagedRuntimeGatewayError(
        "managed_runtime_object_metadata_invalid",
        502,
        false,
      );
    }
  }
  const httpMetadata = {
    ...(headers.get("content-type")
      ? { contentType: headers.get("content-type")! }
      : {}),
    ...(headers.get("cache-control")
      ? { cacheControl: headers.get("cache-control")! }
      : {}),
    ...(headers.get("content-disposition")
      ? { contentDisposition: headers.get("content-disposition")! }
      : {}),
    ...(headers.get("content-encoding")
      ? { contentEncoding: headers.get("content-encoding")! }
      : {}),
    ...(headers.get("content-language")
      ? { contentLanguage: headers.get("content-language")! }
      : {}),
  };
  return {
    ...(headers.get("content-type")
      ? { contentType: headers.get("content-type")! }
      : {}),
    ...(contentLength !== null &&
    /^\d+$/u.test(contentLength) &&
    Number.isSafeInteger(Number(contentLength))
      ? { contentLength: Number(contentLength) }
      : {}),
    ...(headers.get("etag") ? { etag: headers.get("etag")! } : {}),
    ...(Object.keys(httpMetadata).length === 0 ? {} : { httpMetadata }),
    ...(customMetadata === undefined ? {} : { customMetadata }),
  };
}

async function checkedResponse(
  response: Response,
  maxBytes: number,
): Promise<Response> {
  const bounded = await boundedResponse(response, maxBytes);
  const failure = await managedRuntimeGatewayFailure(bounded.clone());
  if (failure) {
    throw new ManagedRuntimeGatewayError(
      failure.code,
      failure.status,
      failure.retryable,
    );
  }
  return bounded;
}

async function expectOkResponse(
  response: Response,
  maxBytes: number,
): Promise<void> {
  const bounded = await checkedResponse(response, maxBytes);
  const body = (await bounded.json().catch(() => undefined)) as
    { readonly ok?: unknown } | undefined;
  if (body?.ok !== true || Object.keys(body).some((key) => key !== "ok")) {
    throw new ManagedRuntimeGatewayError(
      "managed_runtime_response_invalid",
      502,
      false,
    );
  }
}

function assertResponseLimit(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError("managed_runtime_response_limit_invalid");
  }
}

async function boundedResponse(
  response: Response,
  maxBytes: number,
): Promise<Response> {
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > maxBytes)
  ) {
    throw new ManagedRuntimeGatewayError(
      "managed_runtime_response_too_large",
      502,
      false,
    );
  }

  const reader = response.body?.getReader();
  if (!reader) {
    return new Response(null, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel("managed_runtime_response_too_large");
        throw new ManagedRuntimeGatewayError(
          "managed_runtime_response_too_large",
          502,
          false,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
