import { expect, test } from "bun:test";
import { Hono } from "hono";

import { assertSpyCalls, spy } from "#test/mock";
import inboxRoutes from "../routes/activitypub/inbox.ts";
import { generateKeyPair, signRequest } from "../federation-helpers.ts";

// Regression coverage for GA-fix cluster INBOX:
//   #5  inbound activity must NOT be silently lost when a dispatch handler
//       throws — the route releases its fenced claim and returns retryable 503.
//   #17 the dedup ledger plus fenced claim is idempotent; a prior terminal
//       delivery is acknowledged without dispatching it again.

type InsertResult = unknown | null;

/**
 * Build a db mock for the current dedup ledger and fenced-claim flow.
 * `insertedRow: null` represents an already-terminal activity; a non-null value
 * represents a new/unprocessed activity whose claim update succeeds.
 */
function createInboxDbMock(
  publicKeyPem: string,
  opts: {
    insertedRow: InsertResult;
    dispatchThrows?: boolean;
  },
) {
  const getSpy = spy(() =>
    Promise.resolve({
      processed: opts.insertedRow === null ? 1 : 0,
    }),
  );
  const insertValues = spy((..._args: unknown[]) => ({
    onConflictDoNothing: () => Promise.resolve({ rowsAffected: 1 }),
  }));

  // Any select/update chain reached during dispatch is made broadly chainable
  // (or throws when dispatchThrows is set) without aborting the test harness.
  const throwingThen = () => {
    throw new Error("simulated handler failure");
  };
  const followerWhere = {
    orderBy: () => ({ limit: () => Promise.resolve([]) }),
    limit: () => Promise.resolve([]),
    get: () => Promise.resolve(null),
    then: opts.dispatchThrows
      ? throwingThen
      : (resolve: (rows: unknown[]) => void) => resolve([]),
  };

  const db = {
    query: {
      actors: {
        findFirst: spy((..._args: unknown[]) =>
          Promise.resolve({
            apId: "https://test.local/ap/users/bob",
            preferredUsername: "bob",
          }),
        ),
        findMany: spy((..._args: unknown[]) => Promise.resolve([])),
      },
      actorCache: {
        findFirst: spy((..._args: unknown[]) =>
          Promise.resolve({
            apId: "https://remote.example/users/alice",
            publicKeyPem,
            lastFetchedAt: new Date().toISOString(),
          }),
        ),
      },
      activities: {
        findFirst: getSpy,
      },
      blockedActors: {
        findFirst: spy((..._args: unknown[]) => Promise.resolve(null)),
      },
      blockedDomains: {
        findFirst: spy((..._args: unknown[]) => Promise.resolve(null)),
      },
    },
    insert: spy((..._args: unknown[]) => ({ values: insertValues })),
    update: spy((..._args: unknown[]) => ({
      set: () => ({ where: () => Promise.resolve({ rowsAffected: 1 }) }),
    })),
    batch: spy((..._args: unknown[]) => {
      if (opts.dispatchThrows) {
        return Promise.reject(new Error("simulated handler failure"));
      }
      return Promise.resolve([]);
    }),
    select: spy((..._args: unknown[]) => ({
      from: () => ({ where: () => followerWhere }),
    })),
  };

  return { db, insertValues, getSpy };
}

async function postUserInbox(
  db: unknown,
  body: string,
  privateKeyPem: string,
  keyId: string,
) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    (c as unknown as { set: (key: string, value: unknown) => void }).set(
      "db",
      db,
    );
    await next();
  });
  app.route("/", inboxRoutes);

  const url = "https://test.local/ap/users/bob/inbox";
  const headers = await signRequest(privateKeyPem, keyId, "POST", url, body);
  return app.fetch(
    new Request(url, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/activity+json" },
      body,
    }),
    { APP_URL: "https://test.local" },
  );
}

test("#5 user inbox releases the claim and returns retryable 503 on dispatch failure", async () => {
  const { publicKeyPem, privateKeyPem } = await generateKeyPair();
  const actorApId = "https://remote.example/users/alice";
  // Insert succeeds (row returned → dispatch runs), but the dispatched handler
  // throws. Pre-fix this 500'd; the remote would retry, dedup would now find
  // the stored row, and the activity would be permanently lost undispatched.
  const { db } = createInboxDbMock(publicKeyPem, {
    insertedRow: { apId: "https://remote.example/activities/throw-1" },
    dispatchThrows: true,
  });

  const body = JSON.stringify({
    id: "https://remote.example/activities/throw-1",
    type: "Like",
    actor: actorApId,
    object: "https://test.local/ap/objects/one",
  });

  const res = await postUserInbox(
    db,
    body,
    privateKeyPem,
    `${actorApId}#main-key`,
  );

  expect(res.status).toEqual(503);
  expect(res.headers.get("retry-after")).toBe("30");
});

test("#17 user inbox is idempotent 202 when the ledger is already terminal", async () => {
  const { publicKeyPem, privateKeyPem } = await generateKeyPair();
  const actorApId = "https://remote.example/users/alice";
  // A prior delivery already committed this activity. The route must ACK 202
  // without taking a second dispatch claim.
  const { db, getSpy } = createInboxDbMock(publicKeyPem, {
    insertedRow: null,
  });

  const body = JSON.stringify({
    id: "https://remote.example/activities/dup-1",
    type: "Like",
    actor: actorApId,
    object: "https://test.local/ap/objects/one",
  });

  const res = await postUserInbox(
    db,
    body,
    privateKeyPem,
    `${actorApId}#main-key`,
  );

  expect(res.status).toEqual(202);
  // The terminal ledger state was read exactly once.
  assertSpyCalls(getSpy, 1);
});

test("#5 user inbox dispatches and ACKs 202 when the insert wins (happy path)", async () => {
  const { publicKeyPem, privateKeyPem } = await generateKeyPair();
  const actorApId = "https://remote.example/users/alice";
  // getSpy is shared by the inbox dedup insert AND any insert the dispatched
  // handler issues, so we only assert the route outcome (202), not a call count.
  const { db } = createInboxDbMock(publicKeyPem, {
    insertedRow: { apId: "https://remote.example/activities/ok-1" },
  });

  const body = JSON.stringify({
    id: "https://remote.example/activities/ok-1",
    type: "Like",
    actor: actorApId,
    object: "https://test.local/ap/objects/one",
  });

  const res = await postUserInbox(
    db,
    body,
    privateKeyPem,
    `${actorApId}#main-key`,
  );

  expect(res.status).toEqual(202);
});
