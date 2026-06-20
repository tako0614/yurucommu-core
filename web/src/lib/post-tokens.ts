// Parsing of inline @mentions and #hashtags in post bodies. Kept pure and
// separate from the rendering component so the tokenizer is unit-testable.

export type PostToken =
  | { type: "text"; text: string }
  | { type: "mention"; value: string }
  | { type: "hashtag"; value: string };

// A @mention (ASCII handle) or a #hashtag (Unicode word chars, so Japanese
// tags like #海の日 work). Captured groups: 1 = mention handle, 2 = hashtag.
// Returns a FRESH regex each call so the stateful `g` lastIndex is never shared
// between call sites.
export const makeTokenRe = () => /(?:@([a-zA-Z0-9_]+))|(?:#([\p{L}\p{N}_]+))/gu;

// Both mentions and hashtags resolve to a search on the current instance: the
// search page handles "@handle" (actor search) and "#tag" (hashtag search).
export const tokenSearchHref = (query: string) =>
  `/search?search=${encodeURIComponent(query)}`;

// Split plain-text content into text / mention / hashtag tokens, preserving
// order and all surrounding text (including the text after the final token).
export function parsePostTokens(content: string): PostToken[] {
  const parts: PostToken[] = [];
  const re = makeTokenRe();
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", text: content.slice(lastIndex, match.index) });
    }
    if (match[1] !== undefined) {
      parts.push({ type: "mention", value: match[1] });
    } else {
      parts.push({ type: "hashtag", value: match[2] });
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    parts.push({ type: "text", text: content.slice(lastIndex) });
  }

  return parts;
}
