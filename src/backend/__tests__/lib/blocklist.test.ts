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
          (
            { where }: {
              where: {
                _value?: string;
                queryChunks?: Array<{ value: unknown }>;
              };
            },
          ) => {
            // The Drizzle eq() expression we pass exposes the comparison
            // value through internal symbol-keyed fields. We don't need
            // those here — we extract the value by re-reading the lookup
            // that the helper just attempted via the spy call list, but
            // the simpler path is to ship a serialised marker through
            // the spy call below.
            return Promise.resolve(
              state.domains.has(extractEqValue(where)) ? { domain: "x" } : null,
            );
          },
        ),
      },
      blockedActors: {
        findFirst: spy(
          (
            { where }: {
              where: {
                _value?: string;
                queryChunks?: Array<{ value: unknown }>;
              };
            },
          ) => {
            return Promise.resolve(
              state.actors.has(extractEqValue(where))
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

// drizzle `eq(col, value)` produces an SQL fragment whose `queryChunks`
// array holds the literal as a Param. We dig it out for the mock so we can
// branch on the lookup value without standing up a real SQLite database.
function extractEqValue(where: unknown): string {
  if (where && typeof where === "object") {
    const w = where as { queryChunks?: unknown[] };
    if (Array.isArray(w.queryChunks)) {
      for (const chunk of w.queryChunks) {
        if (chunk && typeof chunk === "object") {
          const c = chunk as { value?: unknown };
          if (typeof c.value === "string") return c.value;
        }
      }
    }
  }
  return "";
}

test("normalizeDomain accepts bare hostnames and URLs", () => {
  expect(normalizeDomain("Example.ORG")).toEqual("example.org");
  expect(normalizeDomain("https://Example.ORG/users/alice")).toEqual("example.org");
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
  expect(await isDomainBlocked(db, "https://bad.example/users/eve")).toEqual(true);
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

  expect(await isActorBlocked(db, "https://other.example/users/eve")).toEqual(true);
  expect(await isActorBlocked(db, "https://bad.example/users/mallory")).toEqual(true);
  expect(await isActorBlocked(db, "https://good.example/users/alice")).toEqual(false);
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
  expect(await isActorBlocked(failingDb, "https://bad.example/users/eve")).toEqual(false);
});

test("blockDomain / unblockDomain reject invalid hostname input",
  async () => {
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
  },
);
