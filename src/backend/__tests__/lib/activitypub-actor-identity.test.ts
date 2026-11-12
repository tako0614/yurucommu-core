import { expect, test } from "bun:test";
import {
  isSameActivityPubActor,
  normalizeActivityPubActorId,
} from "../../lib/activitypub-actor-identity.ts";
import { isActorMismatch } from "../../routes/activitypub/inbox.ts";

const actor = "https://identity.example.test/actors/member?view=one";

test("query value tail slash is distinct at the actual signer boundary", () => {
  for (const [left, right] of [
    [actor, actor + "/"],
    [actor + "/", actor],
  ]) {
    const actual = {
      same: isSameActivityPubActor(left, right),
      mismatch: isActorMismatch(left, right),
    };
    expect(actual).toEqual({ same: false, mismatch: true });
  }
});

test("same query retains supported host, scheme, default port and fragment spelling", () => {
  for (const other of [
    actor,
    "https://IDENTITY.example.test/actors/member?view=one",
    "HTTPS://identity.example.test:443/actors/member?view=one",
    actor + "#key",
  ]) {
    expect(isSameActivityPubActor(actor, other)).toBe(true);
    expect(isActorMismatch(other, actor)).toBe(false);
  }
});

test("distinct query case, order and escaped bytes remain significant", () => {
  for (const [left, right] of [
    [actor, actor.replace("one", "One")],
    [actor, actor + "&more=1"],
    [
      actor + "&more=1",
      "https://identity.example.test/actors/member?more=1&view=one",
    ],
    [actor, actor.replace("one", "%6Fne")],
  ]) {
    expect(isSameActivityPubActor(left, right)).toBe(false);
    expect(isActorMismatch(left, right)).toBe(true);
  }
});

test("single terminal path slash stays cosmetic for actors without a query", () => {
  const plain = "https://identity.example.test/actors/member";
  expect(isSameActivityPubActor(plain, plain + "/")).toBe(true);
  expect(isActorMismatch(plain + "/", plain)).toBe(false);
});

test("nonempty query cannot match no query and nondefault ports remain distinct", () => {
  expect(
    isSameActivityPubActor(
      actor,
      "https://identity.example.test/actors/member",
    ),
  ).toBe(false);
  expect(
    isSameActivityPubActor(actor, actor.replace(".test", ".test:444")),
  ).toBe(false);
});

test("nonidentical malformed input and missing actors stay refused", () => {
  expect(isSameActivityPubActor("invalid", actor)).toBe(false);
  expect(isSameActivityPubActor(actor, "invalid")).toBe(false);
  expect(isSameActivityPubActor(null, actor)).toBe(false);
  expect(isSameActivityPubActor(actor, undefined)).toBe(false);
  expect(isSameActivityPubActor("", actor)).toBe(false);
  expect(isActorMismatch(undefined, actor)).toBe(true);
  // Exact-string short circuit is the existing contract, not URL admission.
  expect(isSameActivityPubActor("legacy-value", "legacy-value")).toBe(true);
});

test("persisted normalization outputs retain their legacy byte representation", () => {
  expect(normalizeActivityPubActorId(actor)).toBe(actor);
  expect(normalizeActivityPubActorId(actor + "/")).toBe(actor);
  expect(
    normalizeActivityPubActorId(
      "HTTPS://IDENTITY.example.test:443/actors/member/#key",
    ),
  ).toBe("https://identity.example.test/actors/member");
});
