import { expect, test } from "bun:test";

/**
 * Audit #17 #6 — linkifyTokensInHtml must NOT re-linkify a mention/hashtag that
 * already sits inside an existing (remote) anchor. Doing so emits a nested <a>,
 * which the browser force-closes — hijacking the real federated profile/hashtag
 * link with a local /search link and mangling the DOM.
 */

import { linkifyTokensInHtml } from "./linkify-html.ts";

const countOpenAnchors = (html: string) =>
  (html.match(/<a[\s>]/g) || []).length;

test("a contiguous @handle inside an existing remote anchor is NOT double-wrapped", () => {
  // Misskey/Firefish shape: the full handle is one text node in the anchor body.
  const input = '<a href="https://misskey.io/@alice">@alice@misskey.io</a>';
  const out = linkifyTokensInHtml(input);
  // Exactly the one original anchor — no nested <a>.
  expect(countOpenAnchors(out)).toBe(1);
  expect(out).toContain('href="https://misskey.io/@alice"');
  // The remote link is not replaced by a local /search link.
  expect(out).not.toContain("/search");
});

test("a #hashtag inside an existing remote anchor is NOT double-wrapped", () => {
  const input = '<a href="https://example.social/tags/news">#news</a>';
  const out = linkifyTokensInHtml(input);
  expect(countOpenAnchors(out)).toBe(1);
  expect(out).not.toContain("/search");
});

test("bare mentions/hashtags OUTSIDE any anchor are still linkified", () => {
  const out = linkifyTokensInHtml("hi @bob and #news");
  expect(countOpenAnchors(out)).toBe(2);
  expect(out).toContain('data-mention="bob"');
  expect(out).toContain('data-hashtag="news"');
});

test("a bare token AFTER a remote anchor is linkified once the anchor closes", () => {
  const input = '<a href="https://h/@alice">@alice</a> then @bob';
  const out = linkifyTokensInHtml(input);
  // The original anchor is untouched; only the trailing @bob is linkified.
  expect(countOpenAnchors(out)).toBe(2);
  expect(out).toContain('href="https://h/@alice"');
  expect(out).toContain('data-mention="bob"');
});
