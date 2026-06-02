import { expect, test } from "bun:test";

import { stub } from "#test/mock";
import {
  computeDeliveryJobId,
  computeRetryDelaySeconds,
  DELIVERY_MAX_ATTEMPTS,
  safeEndpointHost,
  safeParseIsoTimeMs,
} from "../../../lib/delivery/transformers.ts";

test("delivery/utils - computeRetryDelaySeconds uses exponential series and jitter bounds", () => {
  const rand = stub(Math, "random", () => 0);
  try {
    expect(computeRetryDelaySeconds(1)).toEqual(48); // 60s * 0.8
    expect(computeRetryDelaySeconds(DELIVERY_MAX_ATTEMPTS)).toEqual(6144); // 7680s * 0.8

    rand.restore();
    const rand2 = stub(Math, "random", () => 1);
    try {
      expect(computeRetryDelaySeconds(1)).toEqual(72); // 60s * 1.2
      expect(computeRetryDelaySeconds(DELIVERY_MAX_ATTEMPTS)).toEqual(9216); // 7680s * 1.2
    } finally {
      rand2.restore();
    }
  } finally {
    try {
      rand.restore();
    } catch {
      /* already restored */
    }
  }
});

test("delivery/utils - computeRetryDelaySeconds clamps attempts", () => {
  const rand = stub(Math, "random", () => 0);
  try {
    expect(computeRetryDelaySeconds(999)).toEqual(6144);
  } finally {
    rand.restore();
  }
});

test("delivery/utils - computeDeliveryJobId is deterministic and hex", async () => {
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

  expect(id1).toEqual(id2);
  expect(id1).not.toEqual(id3);
  expect(id1).toMatch(/^[0-9a-f]{64}$/);
});

test("delivery/utils - safeParseIsoTimeMs returns ms or null", () => {
  const ms = safeParseIsoTimeMs("2026-02-15T00:00:00.000Z");
  expect(typeof ms).toEqual("number");
  expect(Number.isFinite(ms)).toBeTruthy();

  expect(safeParseIsoTimeMs("not-a-date")).toEqual(null);
  expect(safeParseIsoTimeMs(null)).toEqual(null);
  expect(safeParseIsoTimeMs(undefined)).toEqual(null);
});

test("delivery/utils - safeEndpointHost returns host only for safe remote urls", () => {
  expect(safeEndpointHost("https://example.com/inbox")).toEqual("example.com");
  expect(safeEndpointHost("http://127.0.0.1/inbox")).toEqual(null);
  expect(safeEndpointHost("ftp://example.com/x")).toEqual(null);
});
