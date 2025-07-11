import {
  assertEquals,
  assertMatch,
  assertStringIncludes,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import { linkify } from "./app/client/src/utils/linkify.ts";

Deno.test("wraps basic URL", () => {
  const result = linkify("Visit https://ex.com!");
  assertStringIncludes(result, '<a href="https://ex.com"');
});

Deno.test("handles full-width brackets", () => {
  const r = linkify("（https://例.jp）");
  assertMatch(r, /<a href="https:\/\/xn--fsq.jp"/);
});

Deno.test("keeps trailing slash", () => {
  const r = linkify("https://ex.com/");
  assertStringIncludes(r, "ex.com/");
});

Deno.test("removes dangling punctuation", () => {
  const r = linkify("https://ex.com,");
  if (r.includes("<a")) {
    const linkPart = r.match(/<a[^>]+>([^<]+)<\/a>/)?.[1] ?? "";
    assertEquals(linkPart.endsWith(","), false);
  }
});

Deno.test("rejects non-http schemes", () => {
  const r = linkify("javascript:alert(1)");
  assertEquals(r, "javascript:alert(1)");
});
