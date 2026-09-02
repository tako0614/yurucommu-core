import {
  TAKOSUMI_MANAGED_RELATIONAL_RUNTIME_CONTRACT,
  managedRelationalBatchGatewayRequest,
  managedRelationalConnection,
  parseManagedRelationalBatchResponse,
  type ManagedRelationalMethod,
  type ManagedRelationalParameter,
  type ManagedRelationalStatement,
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
import {
  positionalRow,
  rewriteProjection,
  type ProjectedStatement,
} from "./sqlite-proxy-rows.ts";

const DEFAULT_MAX_RELATIONAL_RESPONSE_BYTES = 8 * 1024 * 1024;

/** The lane name a row-shape refusal reports. */
const LANE = "managed relational";

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
 *
 * Row shape is shared with the `edge.sql` lane (`sqlite-proxy-rows.ts`): the
 * projection list is rewritten so no two result columns share a name, the
 * column count that comes back is checked against the count that went out, and
 * the row Drizzle indexes positionally also answers to its column names.
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
    const prepared = statements.map(prepare);
    const request = managedRelationalBatchGatewayRequest(connection.authority, {
      statements: prepared.map((entry) => entry.statement),
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
      prepared.length,
    );
    return value.results.map((result, index) =>
      drizzleResult(result, prepared[index]!),
    );
  };

  const callback: AsyncRemoteCallback = async (sql, params, method) => {
    const [result] = await execute([{ sql, params, method }]);
    if (!result) throw new Error("managed_relational_result_missing");
    return result;
  };
  const batchCallback: AsyncBatchRemoteCallback = async (batch) =>
    await execute(batch);

  return drizzleProxy(callback, batchCallback, { schema });
}

interface PreparedStatement {
  readonly statement: ManagedRelationalStatement;
  readonly projection: ProjectedStatement;
}

/**
 * Trim first, then give every projected column a distinct name.
 *
 * The runtime contract refuses a statement whose text is not already trimmed,
 * and Drizzle does not trim the raw `sql` template a call site wrote across
 * several lines — so the personal block and mute gates' own statements would
 * never reach the host at all.
 */
function prepare(statement: {
  readonly sql: string;
  readonly params: readonly unknown[];
  readonly method: ManagedRelationalMethod;
}): PreparedStatement {
  const source = statement.sql.trim();
  const rewritten = rewriteProjection(source);
  return {
    statement: {
      sql: rewritten.sql,
      params: statement.params.map(relationalParameter),
      method: statement.method,
    },
    projection: { lane: LANE, sql: source, columns: rewritten.columns },
  };
}

/**
 * `sqlite-proxy` wants a flat row for `get` and an array of rows otherwise.
 *
 * A `get` that matched nothing must yield `undefined`, not an empty array:
 * Drizzle's `mapGetResult` short-circuits on a FALSY row, and `[]` is truthy,
 * so an empty array is mapped into an object whose every field is `undefined` —
 * a "row" for a query that found none, which `if (exact) return true` in the
 * personal block gate reads as a hit.
 */
function drizzleResult(
  result: Awaited<
    ReturnType<typeof parseManagedRelationalBatchResponse>
  >["results"][number],
  prepared: PreparedStatement,
) {
  // sqlite-proxy exposes mutable `any[]` at this boundary even though the
  // public runtime contract is intentionally immutable. `positionalRow` copies,
  // so the provider-neutral contract never leaks a mutable result reference.
  const rows = result.rows.map((row) =>
    positionalRow(prepared.projection, result.columns, row),
  );
  return {
    rows: (prepared.statement.method === "get" ? rows[0] : rows) as unknown[],
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
