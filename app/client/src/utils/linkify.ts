// linkify.ts — safer autolink implementation using linkify-it
// ------------------------------------------------------------------
// Replaces the previous hand-rolled RegExp with the well-tested
// `linkify-it` parser so we no longer need to worry about edge-cases
// like adjacent URLs, CJK punctuation, balanced parentheses, etc.
// ------------------------------------------------------------------

import LinkifyIt from "https://esm.sh/linkify-it";
import tlds from "https://esm.sh/tlds@1.233.0"; // Up-to-date IANA TLD list

// --------------------------------------------------
// Tunables
// --------------------------------------------------
const MAX_TEXT_SIZE = 2 * 1024 * 1024; // 2 MiB
const MAX_LINKS = 10;                   // soft-cap per post
const INVISIBLE_RE = /[\u200B-\u200D\uFEFF]/g; // zero-width & BOM
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]); // hard whitelist

// --------------------------------------------------
// Initialise parser
// --------------------------------------------------
export const linkify = new LinkifyIt()
  .tlds(tlds)          // keep the public suffix list fresh
  .set({ fuzzyLink: false }) // no bare "www." or TLD-only matches
  .add("ipfs:", "http:");    // example of extending allowed schemes

// --------------------------------------------------
// Helpers
// --------------------------------------------------
function escapeAttr(value: string): string {
  return value.replace(/"/g, "&quot;");
}

function sanitizeUrl(raw: string): string | null {
  // 1) Remove zero-width chars that can sneak into copy-pastes
  let url = raw.replace(INVISIBLE_RE, "");

  try {
    const parsed = new URL(url);
    if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) return null;
    void parsed.hostname; // punycode normalisation side-effect
    return parsed.toString();
  } catch {
    return null; // malformed → keep as plain text
  }
}

// --------------------------------------------------
// Main entry point: convert plain text to HTML with safe <a> elements
// --------------------------------------------------
export function linkifyText(text: string): string {
  if (text.length > MAX_TEXT_SIZE) return text; // bail-out for very long posts

  const matches = linkify.match(text);
  if (!matches) return text; // fast-path when no URL present

  let result = "";
  let last = 0;
  let count = 0;

  for (const m of matches) {
    // When we exceed MAX_LINKS simply copy the rest verbatim (no more <a>)
    if (count >= MAX_LINKS) break;

    // Preserve text between previous match and current match
    result += text.slice(last, m.index);

    const safeUrl = sanitizeUrl(m.url);
    if (safeUrl) {
      result += `<a href="${escapeAttr(safeUrl)}" rel="noopener noreferrer" target="_blank">${m.raw}</a>`;
      count++;
    } else {
      // Fallback: emit the raw text unchanged
      result += m.raw;
    }

    last = m.lastIndex;
  }

  // Append any remaining text after the last match
  result += text.slice(last);
  return result;
}

// ------------------------------------------------------------------
// Usage example (Deno):
//   import { linkifyText } from "./linkify.ts";
//   console.log(linkifyText("Check https://example.com (and https://foo.bar)"));
// ------------------------------------------------------------------
