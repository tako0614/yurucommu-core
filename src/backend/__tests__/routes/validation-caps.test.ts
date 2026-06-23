import { expect, test } from "bun:test";

import { validateCreatePostBody } from "../../routes/posts/post-helpers.ts";
import { validateOverlays } from "../../routes/stories/query-helpers.ts";
import {
  boundAttachmentsJson,
  boundInboundContent,
  boundInboundSummary,
  MAX_ATTACHMENTS,
  MAX_POST_CONTENT_LENGTH,
  MAX_POST_SUMMARY_LENGTH,
  truncate,
} from "../../routes/posts/transformers.ts";

/**
 * Defense-in-depth payload caps (the global 1 MiB / 512 KiB body limits already
 * bound the worst case; these stop a single post/story/inbound-Note from
 * carrying an oversized attachments/overlays/content blob into the stored row
 * and every federated delivery).
 */

const bodyCtx = (body: unknown) => ({ req: { json: async () => body } });

test("validateCreatePostBody rejects too many attachments", async () => {
  const res = await validateCreatePostBody(
    bodyCtx({
      content: "x",
      attachments: Array.from({ length: MAX_ATTACHMENTS + 1 }, () => ({
        url: "https://a/",
      })),
    }),
  );
  expect(res.ok).toBe(false);
  expect(res.ok === false && res.error).toContain("Too many attachments");
});

test("validateCreatePostBody rejects an oversized attachments payload", async () => {
  const res = await validateCreatePostBody(
    bodyCtx({
      content: "x",
      attachments: [{ url: "x".repeat(20_000) }],
    }),
  );
  expect(res.ok).toBe(false);
  expect(res.ok === false && res.error).toContain("too large");
});

test("validateCreatePostBody accepts a normal attachment set", async () => {
  const res = await validateCreatePostBody(
    bodyCtx({
      content: "hello",
      attachments: [{ url: "https://a/img.png", name: "alt" }],
    }),
  );
  expect(res.ok).toBe(true);
});

test("validateOverlays rejects too many overlays", () => {
  const res = validateOverlays(Array.from({ length: 21 }, () => ({})));
  expect(res.valid).toBe(false);
  expect(res.error).toContain("Too many overlays");
});

test("validateOverlays rejects an oversized overlays payload", () => {
  const res = validateOverlays([{ type: "x".repeat(20_000) }]);
  expect(res.valid).toBe(false);
  expect(res.error).toContain("too large");
});

test("boundInboundContent truncates remote content to the local ceiling", () => {
  const long = "a".repeat(MAX_POST_CONTENT_LENGTH + 500);
  expect(boundInboundContent(long).length).toBe(MAX_POST_CONTENT_LENGTH);
  expect(boundInboundContent("hi")).toBe("hi");
  expect(boundInboundContent(undefined)).toBe("");
  expect(boundInboundContent(42)).toBe("");
});

test("boundInboundSummary truncates / nulls remote summary", () => {
  expect(
    boundInboundSummary("a".repeat(MAX_POST_SUMMARY_LENGTH + 1))?.length,
  ).toBe(MAX_POST_SUMMARY_LENGTH);
  expect(boundInboundSummary("")).toBe(null);
  expect(boundInboundSummary(undefined)).toBe(null);
});

test("boundAttachmentsJson drops an oversized blob to []", () => {
  expect(boundAttachmentsJson("[]")).toBe("[]");
  const small = JSON.stringify([{ url: "https://a/" }]);
  expect(boundAttachmentsJson(small)).toBe(small);
  expect(boundAttachmentsJson("x".repeat(20_000))).toBe("[]");
});

test("truncate is a no-op within bounds", () => {
  expect(truncate("abc", 5)).toBe("abc");
  expect(truncate("abcdef", 3)).toBe("abc");
});
