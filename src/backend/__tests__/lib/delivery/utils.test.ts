import {
  assert,
  assertEquals,
  assertMatch,
  assertNotEquals,
} from "jsr:@std/assert";
import { stub } from "jsr:@std/testing/mock";
import {
  computeDeliveryJobId,
  computeRetryDelaySeconds,
  DELIVERY_MAX_ATTEMPTS,
  safeEndpointHost,
  safeParseIsoTimeMs,
} from "../../../lib/delivery/transformers.ts";

Deno.test("delivery/utils - computeRetryDelaySeconds uses exponential series and jitter bounds", () => {
  const rand = stub(Math, "random", () => 0);
  try {
    assertEquals(computeRetryDelaySeconds(1), 48); // 60s * 0.8
    assertEquals(computeRetryDelaySeconds(DELIVERY_MAX_ATTEMPTS), 6144); // 7680s * 0.8

    rand.restore();
    const rand2 = stub(Math, "random", () => 1);
    try {
      assertEquals(computeRetryDelaySeconds(1), 72); // 60s * 1.2
      assertEquals(computeRetryDelaySeconds(DELIVERY_MAX_ATTEMPTS), 9216); // 7680s * 1.2
    } finally {
      rand2.restore();
    }
  } finally {
    try {
      rand.restore();
    } catch { /* already restored */ }
  }
});

Deno.test("delivery/utils - computeRetryDelaySeconds clamps attempts", () => {
  const rand = stub(Math, "random", () => 0);
  try {
    assertEquals(computeRetryDelaySeconds(999), 6144);
  } finally {
    rand.restore();
  }
});

Deno.test("delivery/utils - computeDeliveryJobId is deterministic and hex", async () => {
  const id1 = await computeDeliveryJobId(
    "activity-1",
    "https://example.com/inbox",
  );
  const id2 = await computeDeliveryJobId(
    "activity-1",
    "https://example.com/inbox",
  );
  const id3 = await computeDeliveryJobId(
    "activity-1",
    "https://example.com/inbox2",
  );

  assertEquals(id1, id2);
  assertNotEquals(id1, id3);
  assertMatch(id1, /^[0-9a-f]{64}$/);
});

Deno.test("delivery/utils - safeParseIsoTimeMs returns ms or null", () => {
  const ms = safeParseIsoTimeMs("2026-02-15T00:00:00.000Z");
  assertEquals(typeof ms, "number");
  assert(Number.isFinite(ms));

  assertEquals(safeParseIsoTimeMs("not-a-date"), null);
  assertEquals(safeParseIsoTimeMs(null), null);
  assertEquals(safeParseIsoTimeMs(undefined), null);
});

Deno.test("delivery/utils - safeEndpointHost returns host only for safe remote urls", () => {
  assertEquals(safeEndpointHost("https://example.com/inbox"), "example.com");
  assertEquals(safeEndpointHost("http://127.0.0.1/inbox"), null);
  assertEquals(safeEndpointHost("ftp://example.com/x"), null);
});
