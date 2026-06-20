import { describe, expect, it } from "bun:test";
import { parsePostTokens, tokenSearchHref } from "./post-tokens.ts";

describe("parsePostTokens", () => {
  it("returns a single text token for plain content", () => {
    expect(parsePostTokens("hello world")).toEqual([
      { type: "text", text: "hello world" },
    ]);
  });

  it("links a trailing hashtag", () => {
    expect(parsePostTokens("海の見える街から🌊 #yurucommu")).toEqual([
      { type: "text", text: "海の見える街から🌊 " },
      { type: "hashtag", value: "yurucommu" },
    ]);
  });

  it("keeps text that follows a mid-body token", () => {
    expect(parsePostTokens("hello #tag world")).toEqual([
      { type: "text", text: "hello " },
      { type: "hashtag", value: "tag" },
      { type: "text", text: " world" },
    ]);
  });

  it("parses a mention", () => {
    expect(parsePostTokens("cc @tako thanks")).toEqual([
      { type: "text", text: "cc " },
      { type: "mention", value: "tako" },
      { type: "text", text: " thanks" },
    ]);
  });

  it("parses mixed mentions and hashtags in order", () => {
    expect(parsePostTokens("@a #b @c")).toEqual([
      { type: "mention", value: "a" },
      { type: "text", text: " " },
      { type: "hashtag", value: "b" },
      { type: "text", text: " " },
      { type: "mention", value: "c" },
    ]);
  });

  it("supports Japanese (Unicode) hashtags", () => {
    expect(parsePostTokens("#海の日 だ")).toEqual([
      { type: "hashtag", value: "海の日" },
      { type: "text", text: " だ" },
    ]);
  });

  it("is stable across calls (no shared regex lastIndex)", () => {
    const input = "#one #two";
    const a = parsePostTokens(input);
    const b = parsePostTokens(input);
    expect(a).toEqual(b);
    expect(a.filter((p) => p.type === "hashtag")).toHaveLength(2);
  });
});

describe("tokenSearchHref", () => {
  it("encodes the # of a hashtag query", () => {
    expect(tokenSearchHref("#yurucommu")).toBe("/search?search=%23yurucommu");
  });

  it("encodes the @ of a mention query", () => {
    expect(tokenSearchHref("@tako")).toBe("/search?search=%40tako");
  });
});
