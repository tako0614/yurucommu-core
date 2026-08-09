import { expect, test } from "bun:test";

import {
  isTrustedRemoteActivityId,
  MAX_REMOTE_ACTIVITY_ID_LENGTH,
} from "../../lib/remote-activity-id.ts";

const ACTOR = "https://peer.example/ap/users/alice";

test("accepts only bounded HTTP(S) ids on the actor's exact origin", () => {
  expect(
    isTrustedRemoteActivityId(
      "https://peer.example/ap/activities/1",
      ACTOR,
      "https://local.example",
    ),
  ).toBeTrue();
  expect(
    isTrustedRemoteActivityId(
      "https://peer.example:443/ap/activities/1",
      ACTOR,
    ),
  ).toBeTrue();

  for (const value of [
    "http://peer.example/ap/activities/downgraded",
    "ftp://peer.example/ap/activities/non-http",
    "https://alice:secret@peer.example/ap/activities/credentialed",
    "https://other.example/ap/activities/foreign",
    " https://peer.example/ap/activities/spaced",
    `https://peer.example/${"x".repeat(MAX_REMOTE_ACTIVITY_ID_LENGTH)}`,
  ]) {
    expect(isTrustedRemoteActivityId(value, ACTOR)).toBeFalse();
  }
});

test("does not trust an id in the receiving server's local namespace", () => {
  expect(
    isTrustedRemoteActivityId(
      "https://local.example/ap/activities/claimed-local-id",
      "https://local.example/ap/users/claimed-local-actor",
      "https://local.example",
    ),
  ).toBeFalse();
});
