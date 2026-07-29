import {
  TAKOSUMI_MANAGED_RELATIONAL_RUNTIME_CONTRACT,
  managedRelationalBatchGatewayRequest,
  managedRelationalConnection,
  parseManagedRelationalBatchResponse,
  type ManagedRelationalMethod,
  type ManagedRelationalParameter,
} from "@takosjp/takosumi-contract/managed-relational-runtime";
import { parseManagedRuntimeConnectionMaterialization } from "@takosjp/takosumi-contract/managed-runtime-connections";
import {
  drizzle as drizzleProxy,
  type AsyncBatchRemoteCallback,
  type AsyncRemoteCallback,
} from "drizzle-orm/sqlite-proxy";

import * as schema from "../../db/schema.ts";
import { ManagedRuntimeGatewayError } from "./managed-runtime.ts";
import type { ManagedRuntimeGateway } from "./managed-runtime.ts";

const DEFAULT_MAX_RELATIONAL_RESPONSE_BYTES = 8 * 1024 * 1024;

export interface ManagedRelationalDatabaseOptions {
  readonly materialization: unknown;
  readonly gateway: ManagedRuntimeGateway;
  readonly alias: string;
  readonly idempotencyKey?: () => string;
  readonly maxResponseBytes?: number;
}

/**
 * Provider-neutral Drizzle adapter for a host-issued RelationalDatabase.
 *
 * Every callback is one bounded prepared statement. Drizzle `batch()` maps to
 * one ordered-atomic host call; transaction-control and migration SQL are
 * deliberately unavailable on this request path.
 */
export function createManagedRelationalDatabase(
  options: ManagedRelationalDatabaseOptions,
) {
  const materialization = parseManagedRuntimeConnectionMaterialization(
    options.materialization,
  );
  const connection = managedRelationalConnection(
    materialization,
    options.alias,
  );
  const idempotencyKey =
    options.idempotencyKey ??
    (() => `yurucommu.relational:${crypto.randomUUID()}`);
  const maxResponseBytes =
    options.maxResponseBytes ?? DEFAULT_MAX_RELATIONAL_RESPONSE_BYTES;
  if (
    !Number.isSafeInteger(maxResponseBytes) ||
    maxResponseBytes < 1 ||
    maxResponseBytes > DEFAULT_MAX_RELATIONAL_RESPONSE_BYTES
  ) {
    throw new TypeError("managed_relational_response_limit_invalid");
  }

  const execute = async (
    statements: readonly {
      readonly sql: string;
      readonly params: readonly unknown[];
      readonly method: ManagedRelationalMethod;
    }[],
  ) => {
    const canonical = statements.map((statement) => ({
      sql: statement.sql,
      params: statement.params.map(relationalParameter),
      method: statement.method,
    }));
    const request = managedRelationalBatchGatewayRequest(connection.authority, {
      statements: canonical,
      idempotencyKey: idempotencyKey(),
    });
    const response = await boundedResponse(
      await options.gateway.fetch(request),
      maxResponseBytes,
    );
    if (!response.ok) {
      const value = (await response.json().catch(() => undefined)) as unknown;
      const code =
        isRecord(value) && typeof value.error === "string"
          ? value.error
          : "managed_relational_request_failed";
      throw new ManagedRuntimeGatewayError(
        code,
        response.status,
        response.status === 429 || response.status >= 500,
      );
    }
    const value = parseManagedRelationalBatchResponse(
      await response.json(),
      canonical.length,
    );
    return value.results;
  };

  const callback: AsyncRemoteCallback = async (sql, params, method) => {
    const [result] = await execute([{ sql, params, method }]);
    if (!result) throw new Error("managed_relational_result_missing");
    return drizzleResult(result, method);
  };
  const batchCallback: AsyncBatchRemoteCallback = async (batch) => {
    const results = await execute(batch);
    return results.map((result, index) =>
      drizzleResult(result, batch[index]!.method),
    );
  };

  return drizzleProxy(callback, batchCallback, { schema });
}

function drizzleResult(
  result: Awaited<
    ReturnType<typeof parseManagedRelationalBatchResponse>
  >["results"][number],
  method: ManagedRelationalMethod,
) {
  return {
    // sqlite-proxy exposes mutable `any[]` at this boundary even though the
    // public runtime contract is intentionally immutable. Copy here so the
    // provider-neutral contract never leaks a mutable result reference.
    rows:
      method === "get"
        ? [...(result.rows[0] ?? [])]
        : result.rows.map((row) => [...row]),
    meta: result.meta,
  };
}

function relationalParameter(value: unknown): ManagedRelationalParameter {
  if (value === null || typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  throw new TypeError("managed_relational_parameter_unsupported");
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
      "managed_relational_response_too_large",
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
        await reader.cancel("managed_relational_response_too_large");
        throw new ManagedRuntimeGatewayError(
          "managed_relational_response_too_large",
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
