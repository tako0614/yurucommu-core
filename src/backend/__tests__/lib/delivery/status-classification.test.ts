import { expect, test } from "bun:test";

/**
 * Audit #17 #1/#2 — outbound delivery failure classification. A delivery job is
 * keyed by the shared-inbox endpoint (one job per N co-tenant recipients), so a
 * status mis-classified as permanent black-holes the activity for ALL of them.
 * 401 (signature-verify failure) and 404 (endpoint blip) are TRANSIENT and must
 * be retried; 410/403/400/422 are permanent.
 */

import {
  isPermanentDeliveryFailure,
  TRANSIENT_DELIVERY_4XX,
} from "../../../lib/delivery/queue-delivery.ts";

test("401 (sig-verify failure) and 404 (endpoint blip) are RETRYABLE, not permanent", () => {
  expect(isPermanentDeliveryFailure(401)).toBe(false);
  expect(isPermanentDeliveryFailure(404)).toBe(false);
  expect(TRANSIENT_DELIVERY_4XX.has(401)).toBe(true);
  expect(TRANSIENT_DELIVERY_4XX.has(404)).toBe(true);
});

test("classic transient 4xx (408/425/429) remain retryable", () => {
  expect(isPermanentDeliveryFailure(408)).toBe(false);
  expect(isPermanentDeliveryFailure(425)).toBe(false);
  expect(isPermanentDeliveryFailure(429)).toBe(false);
});

test("410 Gone and deliberate/per-activity 4xx (400/403/422) are PERMANENT", () => {
  expect(isPermanentDeliveryFailure(410)).toBe(true);
  expect(isPermanentDeliveryFailure(400)).toBe(true);
  expect(isPermanentDeliveryFailure(403)).toBe(true);
  expect(isPermanentDeliveryFailure(422)).toBe(true);
});

test("5xx and a null (network-error) status are NOT classified permanent here", () => {
  // 5xx is retried by the downstream path, not failed permanently.
  expect(isPermanentDeliveryFailure(500)).toBe(false);
  expect(isPermanentDeliveryFailure(503)).toBe(false);
  // A network error (no HTTP status) is handled by the retry path, not here.
  expect(isPermanentDeliveryFailure(null)).toBe(false);
});
