import { expect, test } from "bun:test";

import {
  MAX_INBOUND_REPLY_TARGET_LENGTH,
  validateInboundReplyTarget,
} from "../../../routes/activitypub/handlers/inbound-reply-target.ts";

test("reply target preserves omission and explicit clearing", () => {
  expect(validateInboundReplyTarget(undefined)).toEqual({
    ok: true,
    parentId: undefined,
  });
  expect(validateInboundReplyTarget(null)).toEqual({
    ok: true,
    parentId: null,
  });
});

test("reply target accepts a safe local or remote IRI at the storage bound", () => {
  const prefix = "https://remote.example/objects/";
  const boundary = `${prefix}${"x".repeat(
    MAX_INBOUND_REPLY_TARGET_LENGTH - prefix.length,
  )}`;
  expect(boundary).toHaveLength(MAX_INBOUND_REPLY_TARGET_LENGTH);
  expect(validateInboundReplyTarget(boundary)).toEqual({
    ok: true,
    parentId: boundary,
  });
  expect(
    validateInboundReplyTarget("https://yuru.test/ap/objects/local-parent"),
  ).toEqual({
    ok: true,
    parentId: "https://yuru.test/ap/objects/local-parent",
  });
});

test("reply target rejects values that cannot be retained as one safe edge", () => {
  const prefix = "https://remote.example/objects/";
  expect(validateInboundReplyTarget(42)).toEqual({
    ok: false,
    reason: "malformed",
  });
  expect(validateInboundReplyTarget({ id: `${prefix}embedded` })).toEqual({
    ok: false,
    reason: "malformed",
  });
  expect(validateInboundReplyTarget("")).toEqual({
    ok: false,
    reason: "malformed",
  });
  expect(
    validateInboundReplyTarget(
      `${prefix}${"x".repeat(MAX_INBOUND_REPLY_TARGET_LENGTH)}`,
    ),
  ).toEqual({ ok: false, reason: "too_long" });
  expect(validateInboundReplyTarget("javascript:alert(1)")).toEqual({
    ok: false,
    reason: "unsafe",
  });
  expect(
    validateInboundReplyTarget(
      "https://user:pass@remote.example/objects/credential-parent",
    ),
  ).toEqual({ ok: false, reason: "unsafe" });
});
