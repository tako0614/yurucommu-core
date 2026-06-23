import { expect, test } from "bun:test";
import { assert, assertEquals, assertRejects } from "#test/assert";
import { spy } from "#test/mock";

import {
  isActorBlocked,
  isDomainBlocked,
  normalizeDomain,
} from "../../lib/blocklist.ts";
import type { Database } from "../../../db/index.ts";

interface MockBlocklistDb {
  domains: Set<string>;
  actors: Set<string>;
  domainLookups: Array<{ domain: string }>;
  actorLookups: Array<{ actorApId: string }>;
}

function createBlocklistDb(state: MockBlocklistDb): Database {
  const db = {
    query: {
      blockedDomains: {
        findFirst: spy(
          ({
            where,
          }: {
            where: {
              _value?: string;
              queryChunks?: Array<{ value: unknown }>;
            };
          }) => {
            // The Drizzle eq() expression we pass exposes the comparison
            // value through internal symbol-keyed fields. We don't need
            // those here — we extract the value by re-reading the lookup
            // that the helper just attempted via the spy call list, but
            // the simpler path is to ship a serialised marker through
            // the spy call below.
            return Promise.resolve(
              extractValues(where).some((v) => state.domains.has(v))
                ? { domain: "x" }
                : null,
            );
          },
        ),
      },
      blockedActors: {
        findFirst: spy(
          ({
            where,
          }: {
            where: {
              _value?: string;
              queryChunks?: Array<{ value: unknown }>;
            };
          }) => {
            return Promise.resolve(
              extractValues(where).some((v) => state.actors.has(v))
                ? { actorApId: "x" }
                : null,
            );
          },
        ),
      },
    },
  };
  return db as unknown as Database;
}

// drizzle `eq(col, value)` / `inArray(col, values)` produce an SQL fragment
// whose `queryChunks` array holds the literal(s) as Param(s). We dig them out
// for the mock so we can branch on the lookup value(s) without standing up a
// real SQLite database. `eq` yields a single string value; `inArray` (used by
// isDomainBlocked's subdomain candidate lookup) yields an array value — collect
// both shapes so any-match works.
function extractValues(where: unknown): string[] {
  // Walk the drizzle SQL fragment recursively, collecting every string literal
  // carried by a Param. `eq` keeps its value at the top level; `inArray` nests
  // the per-element Params inside a sub-SQL chunk, so a recursive walk handles
  // both without depending on the exact nesting depth.
  const out: string[] = [];
  const seen = new Set<unknown>();
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const el of node) {
        if (typeof el === "string") out.push(el);
        else visit(el);
      }
      return;
    }
    const n = node as { value?: unknown; queryChunks?: unknown[] };
    if (typeof n.value === "string") out.push(n.value);
    else if (Array.isArray(n.value)) {
      for (const v of n.value) if (typeof v === "string") out.push(v);
    }
    // `inArray` nests its element Params inside a raw JS-array queryChunk.
    if (Array.isArray(n.queryChunks)) for (const c of n.queryChunks) visit(c);
  };
  visit(where);
  return out;
}

test("normalizeDomain accepts bare hostnames and URLs", () => {
  expect(normalizeDomain("Example.ORG")).toEqual("example.org");
  expect(normalizeDomain("https://Example.ORG/users/alice")).toEqual(
    "example.org",
  );
  expect(normalizeDomain("example.org.")).toEqual("example.org");
  expect(normalizeDomain("")).toEqual(null);
});

test("isDomainBlocked returns true for blocked hostnames", async () => {
  const state: MockBlocklistDb = {
    domains: new Set(["bad.example"]),
    actors: new Set(),
    domainLookups: [],
    actorLookups: [],
  };
  const db = createBlocklistDb(state);

  expect(await isDomainBlocked(db, "bad.example")).toEqual(true);
  expect(await isDomainBlocked(db, "https://bad.example/users/eve")).toEqual(
    true,
  );
  expect(await isDomainBlocked(db, "good.example")).toEqual(false);
});

test("isActorBlocked falls through to the domain blocklist", async () => {
  const state: MockBlocklistDb = {
    domains: new Set(["bad.example"]),
    actors: new Set(["https://other.example/users/eve"]),
    domainLookups: [],
    actorLookups: [],
  };
  const db = createBlocklistDb(state);

  expect(await isActorBlocked(db, "https://other.example/users/eve")).toEqual(
    true,
  );
  expect(await isActorBlocked(db, "https://bad.example/users/mallory")).toEqual(
    true,
  );
  expect(await isActorBlocked(db, "https://good.example/users/alice")).toEqual(
    false,
  );
});

test("isActorBlocked returns false on empty/invalid input", async () => {
  const state: MockBlocklistDb = {
    domains: new Set(),
    actors: new Set(),
    domainLookups: [],
    actorLookups: [],
  };
  const db = createBlocklistDb(state);

  expect(await isActorBlocked(db, "")).toEqual(false);
  expect(await isActorBlocked(db, "not-a-url")).toEqual(false);
});

test("isDomainBlocked falls back to false on DB errors", async () => {
  const failingDb = {
    query: {
      blockedDomains: {
        findFirst: () => Promise.reject(new Error("db down")),
      },
      blockedActors: {
        findFirst: () => Promise.reject(new Error("db down")),
      },
    },
  } as unknown as Database;

  expect(await isDomainBlocked(failingDb, "bad.example")).toEqual(false);
  expect(
    await isActorBlocked(failingDb, "https://bad.example/users/eve"),
  ).toEqual(false);
});

test("blockDomain / unblockDomain reject invalid hostname input", async () => {
  const noopDb = {
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: () => Promise.resolve(),
      }),
    }),
    delete: () => ({ where: () => Promise.resolve() }),
  } as unknown as Database;

  // Re-import to access the mutator helpers without a real connection.
  const mod = await import("../../lib/blocklist.ts");

  await assertRejects(
    () => mod.blockDomain(noopDb, "", null),
    Error,
    "invalid input",
  );
  await assertRejects(
    () => mod.unblockDomain(noopDb, ""),
    Error,
    "invalid input",
  );
  // valid hostname should not throw with the noop db
  await mod.blockDomain(noopDb, "bad.example", "spam");
  await mod.unblockDomain(noopDb, "bad.example");
  expect(true).toBeTruthy();
});
