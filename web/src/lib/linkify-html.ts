import { makeTokenRe, tokenSearchHref } from "./post-tokens.ts";

// Linkify bare @mentions and #hashtags in the text regions of an
// already-sanitized HTML string, without touching anything inside `<...>` tags
// (so existing href attributes and anchor text are left intact). Links are
// emitted with the same rel policy the sanitizer enforces.
export function linkifyTokensInHtml(html: string): string {
  let out = "";
  let i = 0;
  // Depth of the existing <a> element we are currently inside. Remote
  // (Mastodon/Misskey/Pleroma) Notes often arrive with mentions/hashtags ALREADY
  // linkified, and some implementations put the literal "@user"/"#tag" as a
  // contiguous text node in the anchor body. The sanitizer preserves that anchor
  // (https href is allowlisted), so re-linkifying its text would emit a NESTED
  // <a> — illegal HTML that the browser force-closes, replacing the real
  // federated profile/hashtag link with a local /search link (a link hijack) and
  // mangling the surrounding DOM. Suppress token replacement while depth > 0.
  let anchorDepth = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    const segmentEnd = lt === -1 ? html.length : lt;
    const text = html.slice(i, segmentEnd);
    out +=
      anchorDepth > 0
        ? text
        : text.replace(makeTokenRe(), (full, mention, hashtag) => {
            const query = mention !== undefined ? `@${mention}` : `#${hashtag}`;
            const href = tokenSearchHref(query);
            const attr =
              mention !== undefined
                ? `data-mention="${mention}"`
                : `data-hashtag="${hashtag}"`;
            return (
              `<a href="${href}" rel="noopener noreferrer nofollow" ${attr}>` +
              `${full}</a>`
            );
          });
    if (lt === -1) break;
    const gt = html.indexOf(">", lt + 1);
    const tagEnd = gt === -1 ? html.length : gt + 1;
    const tag = html.slice(lt, tagEnd);
    // Track <a>…</a> nesting on the already-sanitized markup (lowercased names,
    // close tags carry no attributes).
    if (/^<\s*a[\s>]/i.test(tag)) anchorDepth += 1;
    else if (/^<\s*\/\s*a\s*>/i.test(tag))
      anchorDepth = Math.max(0, anchorDepth - 1);
    out += tag;
    i = tagEnd;
  }
  return out;
}
