/**
 * A request-local, fail-closed Drizzle write boundary. Each mutation is one
 * atomic D1/libsql batch: assertion, payload, assertion. Building a query is
 * still lazy; the assertions run only when the query executes.
 *
 * Pinned Drizzle 0.45.2 contract: SQLite mutation builders expose `_prepare()`
 * with `executeMethod` (`all` for RETURNING, `run` otherwise). Driver batch()
 * calls `_prepare()` and maps each result through `mapResult(..., true)`. The
 * read-only inspection below and the explicit raw action batch items preserve
 * `.all()`, `.get()`, `.values()`, and `.run()` semantics without mutating ORM
 * internals. A Drizzle upgrade must recheck this contract and its tests.
 * This is a trusted in-process API boundary, not a JavaScript sandbox. Its
 * atomicity also requires the driver's batch callback to be transactional;
 * D1 and libsql provide that contract.
 */

import type { SQL } from "drizzle-orm";
import type { Database } from "./index.ts";
import {
  D1BatchTooLargeError,
  D1BatchUnsupportedError,
  D1_MAX_BATCH_STATEMENTS,
  rawBatchStatement,
  type D1Statement,
} from "./d1-write.ts";

type BatchableDb = Database & {
  batch(
    statements: readonly [D1Statement, ...D1Statement[]],
  ): Promise<unknown[]>;
};

export type WriteGuardStatements = {
  before: D1Statement;
  after: D1Statement;
  onError?: (error: unknown) => unknown;
};

type ExecutableMutation = D1Statement & {
  getSQL(): SQL;
  _prepare(): { executeMethod: "all" | "run" };
};

// Nested request + target guards must hand the original builders to the final
// driver batch. These maps are module-private: callers cannot obtain either
// the original builder or the underlying database through the facade.
const ORIGINAL_BUILDER = new WeakMap<object, object>();
const RAW_DATABASE = new WeakMap<object, Database>();

const DENIED_BUILDER_MEMBERS = new Set([
  "session",
  "dialect",
  "_",
  "$client",
  "client",
  "prepare",
  "_prepare",
]);

function forbidden(member: string): never {
  throw new Error(`guarded writes: ${member} bypasses the write guard`);
}

/**
 * Guard every insert/update/delete produced by this DB facade. The `before`
 * and `after` statements are built at execution time, so a caller may capture
 * current request state in their predicates. `after` must fail as a SQL
 * statement when the assertion is false; the driver then rolls back the batch.
 */
export function createGuardedDatabase(
  db: Database,
  guardFactory: () => WriteGuardStatements,
): Database {
  const candidate = db as Partial<BatchableDb>;
  if (typeof candidate.batch !== "function") {
    throw new D1BatchUnsupportedError(
      "guarded writes require an atomic db.batch() driver",
    );
  }
  const original = candidate as BatchableDb;
  const rawDatabase = RAW_DATABASE.get(db) ?? db;
  const wrapped = new WeakMap<object, object>();
  const wrappedReads = new WeakMap<object, object>();

  function unwrap<T>(statement: T): T {
    let current: unknown = statement;
    while (typeof current === "object" && current !== null) {
      const next = ORIGINAL_BUILDER.get(current);
      if (!next) break;
      current = next;
    }
    return current as T;
  }

  async function guardedBatch(
    payload: readonly D1Statement[],
  ): Promise<unknown[]> {
    if (payload.length > D1_MAX_BATCH_STATEMENTS - 2) {
      throw new D1BatchTooLargeError(
        `guarded writes accept at most ${D1_MAX_BATCH_STATEMENTS - 2} payload statements per batch`,
      );
    }
    if (payload.length === 0) {
      throw new Error("guarded writes require at least one payload statement");
    }
    let onError: WriteGuardStatements["onError"];
    try {
      const guard = guardFactory();
      onError = guard.onError;
      const statements = [
        unwrap(guard.before),
        ...payload.map(unwrap),
        unwrap(guard.after),
      ] as [D1Statement, ...D1Statement[]];
      const results = await original.batch(statements);
      return results.slice(1, -1);
    } catch (error) {
      if (onError) throw onError(error);
      throw error;
    }
  }

  function mutationBuilder(value: unknown): value is object {
    if (typeof value !== "object" || value === null) return false;
    const candidate = unwrap(value) as Record<string, unknown>;
    return (
      typeof candidate._prepare === "function" ||
      typeof candidate.set === "function" ||
      typeof candidate.values === "function"
    );
  }

  function wrapMutation<T extends object>(target: T): T {
    const prior = wrapped.get(target);
    if (prior) return prior as T;

    const proxy = new Proxy(target, {
      get(object, property) {
        if (
          typeof property === "string" &&
          DENIED_BUILDER_MEMBERS.has(property)
        ) {
          return forbidden(property);
        }
        const value = Reflect.get(object, property, object) as unknown;
        if (property === "constructor") return value;
        const executable =
          typeof (object as { getSQL?: unknown }).getSQL === "function";
        if (executable && property === "then") {
          return (
            fulfilled?: (value: unknown) => unknown,
            rejected?: (reason: unknown) => unknown,
          ) =>
            guardedBatch([object as ExecutableMutation])
              .then(([result]) => result)
              .then(fulfilled, rejected);
        }
        if (executable && property === "catch") {
          return (rejected?: (reason: unknown) => unknown) =>
            guardedBatch([object as ExecutableMutation])
              .then(([result]) => result)
              .catch(rejected);
        }
        if (executable && property === "finally") {
          return (callback?: () => void) =>
            guardedBatch([object as ExecutableMutation])
              .then(([result]) => result)
              .finally(callback);
        }
        if (
          executable &&
          typeof property === "string" &&
          ["execute", "run", "all", "get", "values"].includes(property)
        ) {
          return (placeholders?: Record<string, unknown>) => {
            if (placeholders !== undefined) {
              return forbidden("mutation placeholders");
            }
            const mutation = object as ExecutableMutation;
            if (property === "execute") {
              return guardedBatch([mutation]).then(([result]) => result);
            }
            if (property === "run") {
              return guardedBatch([
                rawBatchStatement(rawDatabase, mutation.getSQL()),
              ]).then(([result]) => result);
            }
            if (property === "values") {
              return guardedBatch([
                rawBatchStatement(rawDatabase, mutation.getSQL(), "values"),
              ]).then(([result]) => result);
            }
            // Drizzle's batch maps a RETURNING builder to selected row objects.
            // For a mutation without RETURNING, its default batch result is a
            // driver result, so use the corresponding raw read action instead.
            const returning =
              (unwrap(mutation) as ExecutableMutation)._prepare()
                .executeMethod === "all";
            if (!returning) {
              const raw =
                property === "all"
                  ? rawBatchStatement(rawDatabase, mutation.getSQL(), "all")
                  : rawBatchStatement(rawDatabase, mutation.getSQL(), "get");
              return guardedBatch([raw]).then(([result]) => result);
            }
            return guardedBatch([mutation]).then(([rows]) =>
              property === "get" ? (rows as unknown[])[0] : rows,
            );
          };
        }
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          const result = Reflect.apply(value, object, args) as unknown;
          return mutationBuilder(result) ? wrapMutation(result) : result;
        };
      },
    });
    wrapped.set(target, proxy);
    ORIGINAL_BUILDER.set(proxy, target);
    return proxy;
  }

  function wrapPreparedRead<T extends object>(target: T): T {
    return new Proxy(target, {
      get(object, property) {
        if (
          property !== "execute" &&
          property !== "all" &&
          property !== "get" &&
          property !== "values" &&
          property !== "run" &&
          property !== "getQuery"
        ) {
          return forbidden(`prepared read ${String(property)}`);
        }
        const member = Reflect.get(object, property, object) as unknown;
        return typeof member === "function" ? member.bind(object) : member;
      },
    });
  }

  function readBuilder(value: unknown): value is object {
    if (typeof value !== "object" || value === null) return false;
    return "session" in value || "dialect" in value || "from" in value;
  }

  function wrapRead<T extends object>(target: T): T {
    const prior = wrappedReads.get(target);
    if (prior) return prior as T;
    const proxy = new Proxy(target, {
      get(object, property) {
        if (property === "prepare") {
          const prepare = Reflect.get(object, property, object) as Function;
          return (...args: unknown[]) =>
            wrapPreparedRead(Reflect.apply(prepare, object, args) as object);
        }
        if (
          property === "session" ||
          property === "dialect" ||
          property === "_" ||
          property === "_prepare" ||
          property === "client" ||
          property === "$client" ||
          property === "params"
        ) {
          return forbidden(`read ${String(property)}`);
        }
        const member = Reflect.get(object, property, object) as unknown;
        if (property === "constructor") return member;
        if (typeof member !== "function") return member;
        return (...args: unknown[]) => {
          const result = Reflect.apply(member, object, args) as unknown;
          return readBuilder(result) ? wrapRead(result) : result;
        };
      },
    });
    wrappedReads.set(target, proxy);
    ORIGINAL_BUILDER.set(proxy, target);
    return proxy;
  }

  function relationalQueries(): Database["query"] {
    return new Proxy(rawDatabase.query, {
      get(namespace, table) {
        const builder = Reflect.get(namespace, table, namespace) as object;
        return new Proxy(builder, {
          get(tableBuilder, operation) {
            if (operation !== "findMany" && operation !== "findFirst") {
              return forbidden(`relational query ${String(operation)}`);
            }
            const method = Reflect.get(
              tableBuilder,
              operation,
              tableBuilder,
            ) as Function;
            return (...args: unknown[]) =>
              wrapRead(Reflect.apply(method, tableBuilder, args) as object);
          },
        });
      },
    }) as Database["query"];
  }

  function rawRead(member: "all" | "get" | "values", query: unknown): unknown {
    const raw = Reflect.apply(rawDatabase[member], rawDatabase, [query]) as {
      getQuery(): { sql: string };
    };
    const statement = raw.getQuery().sql.trim();
    // Raw SQL has no Drizzle query kind. Keep this narrow so `db.get(sql`...`)`
    // cannot smuggle a write through the original session.
    if (
      !/^(?:SELECT\b|EXPLAIN(?:\s+QUERY\s+PLAN)?\s+SELECT\b)/i.test(
        statement,
      ) ||
      /;\s*\S/.test(statement)
    ) {
      return forbidden(`raw ${member}`);
    }
    return raw;
  }

  const facade = new Proxy(db, {
    get(object, property) {
      if (property === "constructor" || typeof property === "symbol") {
        return Reflect.get(rawDatabase, property, rawDatabase);
      }
      if (property === "batch") {
        return (statements: readonly D1Statement[]) => guardedBatch(statements);
      }
      if (property === "all" || property === "get" || property === "values") {
        return (query: unknown) => rawRead(property, query);
      }
      if (property === "with") {
        return (...args: unknown[]) => {
          const cte = Reflect.apply(
            rawDatabase.with,
            rawDatabase,
            args,
          ) as Record<string, unknown>;
          return new Proxy(cte, {
            get(cteObject, key) {
              const member = Reflect.get(cteObject, key, cteObject) as unknown;
              if (
                (key === "insert" || key === "update" || key === "delete") &&
                typeof member === "function"
              ) {
                return (...inner: unknown[]) =>
                  wrapMutation(
                    Reflect.apply(member, cteObject, inner) as object,
                  );
              }
              if (
                (key === "select" || key === "selectDistinct") &&
                typeof member === "function"
              ) {
                return (...inner: unknown[]) =>
                  wrapRead(Reflect.apply(member, cteObject, inner) as object);
              }
              return member;
            },
          });
        };
      }
      if (
        property !== "insert" &&
        property !== "update" &&
        property !== "delete" &&
        property !== "select" &&
        property !== "selectDistinct" &&
        property !== "query" &&
        property !== "$with" &&
        property !== "$count"
      ) {
        return forbidden(String(property));
      }
      if (property === "query") return relationalQueries();
      const member = Reflect.get(rawDatabase, property, rawDatabase) as unknown;
      if (
        (property === "insert" ||
          property === "update" ||
          property === "delete") &&
        typeof member === "function"
      ) {
        return (...args: unknown[]) =>
          wrapMutation(Reflect.apply(member, rawDatabase, args) as object);
      }
      if (
        (property === "select" ||
          property === "selectDistinct" ||
          property === "$count") &&
        typeof member === "function"
      ) {
        return (...args: unknown[]) =>
          wrapRead(Reflect.apply(member, rawDatabase, args) as object);
      }
      return typeof member === "function" ? member.bind(rawDatabase) : member;
    },
  }) as Database;
  RAW_DATABASE.set(facade, rawDatabase);
  return facade;
}

/** Closure form for callers that build each assertion independently. */
export function withGuardedWrites(
  db: Database,
  guard: {
    before: () => D1Statement;
    after: () => D1Statement;
    onError?: (error: unknown) => unknown;
  },
): Database {
  return createGuardedDatabase(db, () => ({
    before: guard.before(),
    after: guard.after(),
    onError: guard.onError,
  }));
}
