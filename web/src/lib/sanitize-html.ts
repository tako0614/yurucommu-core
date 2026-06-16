// Dependency-light, environment-agnostic HTML sanitizer for remote
// ActivityPub content. This is a pure string transform (no DOM dependency) so
// it behaves identically in the browser, in a Worker, and under `bun test`.
//
// SECURITY: the output of this function is rendered via `innerHTML` in
// PostContent.tsx. It MUST be XSS-safe. The design is allowlist-only:
// anything not explicitly permitted is dropped. When in doubt, drop.

// Tags whose start/end tags are preserved (their text content is always kept;
// only the tags themselves are filtered).
const ALLOWED_TAGS = new Set([
  "p",
  "br",
  "a",
  "span",
  "em",
  "strong",
  "b",
  "i",
  "u",
  "ul",
  "ol",
  "li",
  "blockquote",
  "code",
  "pre",
]);

// Void elements that never carry an end tag.
const VOID_TAGS = new Set(["br"]);

// Drop-content tags that are void (no end tag): they have no body to skip, so
// we must not enter drop-content mode for them or we would eat trailing text.
const VOID_DROP_TAGS = new Set(["embed"]);

// Tags whose entire subtree (including text content) must be discarded. Even
// though these are not in ALLOWED_TAGS, their text content would otherwise
// leak through (e.g. inline script source, CSS), so we drop their bodies too.
const DROP_CONTENT_TAGS = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "noscript",
  "template",
  "title",
  "textarea",
  "svg",
  "math",
]);

const SAFE_URL_SCHEMES = new Set(["http:", "https:", "mailto:"]);

// Whitespace + control/format characters that browsers ignore inside a URL
// scheme token. Constructed from escape sequences so the source stays plain
// ASCII (covers C0 controls, space, NBSP, zero-width chars, and the BOM).
// eslint-disable-next-line no-control-regex
const SCHEME_NOISE_RE = new RegExp(
  "[\\u0000-\\u0020\\u00a0\\u200b-\\u200d\\ufeff]+",
  "g",
);

// Strip HTML comments and CDATA up front so `<!-- <script> -->` tricks and
// `<![CDATA[ ... ]]>` cannot smuggle markup past the tokenizer.
function stripComments(input: string): string {
  let out = "";
  let i = 0;
  while (i < input.length) {
    if (input.startsWith("<!--", i)) {
      const end = input.indexOf("-->", i + 4);
      if (end === -1) return out; // unterminated comment: drop the rest
      i = end + 3;
      continue;
    }
    if (input.startsWith("<![CDATA[", i)) {
      const end = input.indexOf("]]>", i + 9);
      if (end === -1) return out;
      i = end + 3;
      continue;
    }
    out += input[i];
    i += 1;
  }
  return out;
}

// Escape text so it is rendered literally (never interpreted as markup).
function escapeText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Escape an attribute value for safe inclusion inside double quotes.
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function safeFromCodePoint(cp: number): string {
  if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return "";
  try {
    return String.fromCodePoint(cp);
  } catch {
    return "";
  }
}

// Decode the small set of entities needed to inspect URL schemes safely. We do
// NOT use this output for rendering — only for deciding whether a URL is safe.
function decodeForSchemeCheck(value: string): string {
  let decoded = value
    .replace(/&#x([0-9a-fA-F]+);?/g, (_m, hex: string) =>
      safeFromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);?/g, (_m, dec: string) =>
      safeFromCodePoint(parseInt(dec, 10)),
    )
    .replace(/&colon;/gi, ":")
    .replace(/&tab;/gi, "\t")
    .replace(/&newline;/gi, "\n")
    .replace(/&amp;/gi, "&");
  // Remove whitespace/control noise that browsers ignore inside a scheme token
  // (e.g. `java\tscript:`, `java\nscript:`, NUL-padded schemes).
  decoded = decoded.replace(SCHEME_NOISE_RE, "");
  return decoded;
}

// Decide whether an href is a safe, http(s)/mailto link. Returns the original
// (attribute-escaped) value when safe, or null when it must be dropped.
function sanitizeHref(raw: string): string | null {
  const probe = decodeForSchemeCheck(raw).toLowerCase();
  // Reject anything that declares a non-allowlisted scheme up front.
  if (/^[a-z][a-z0-9+.-]*:/.test(probe)) {
    const scheme = probe.slice(0, probe.indexOf(":") + 1);
    if (!SAFE_URL_SCHEMES.has(scheme)) return null;
  }
  // Defensive: explicit dangerous-scheme catch even if the regex above misses
  // an exotic shape.
  if (
    probe.startsWith("javascript:") ||
    probe.startsWith("data:") ||
    probe.startsWith("vbscript:") ||
    probe.startsWith("file:") ||
    probe.startsWith("blob:")
  ) {
    return null;
  }
  return escapeAttr(raw.trim());
}

interface ParsedTag {
  name: string; // lowercased tag name
  isClosing: boolean;
  isSelfClosing: boolean;
  attrs: Map<string, string>;
}

// Parse the inside of a `<...>` tag (without the angle brackets).
function parseTag(inner: string): ParsedTag | null {
  let s = inner.trim();
  const isClosing = s.startsWith("/");
  if (isClosing) s = s.slice(1).trim();
  let isSelfClosing = false;
  if (s.endsWith("/")) {
    isSelfClosing = true;
    s = s.slice(0, -1).trim();
  }
  const nameMatch = /^([a-zA-Z][a-zA-Z0-9-]*)/.exec(s);
  if (!nameMatch) return null;
  const name = nameMatch[1].toLowerCase();
  const rest = s.slice(nameMatch[1].length);
  const attrs = new Map<string, string>();

  if (!isClosing) {
    // Attribute parser: name(=("..."|'...'|bare))? repeated.
    const attrRe =
      /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s"'`=<>]+)))?/g;
    let m: RegExpExecArray | null;
    while ((m = attrRe.exec(rest)) !== null) {
      if (m[0].trim() === "") break;
      const attrName = m[1].toLowerCase();
      const value = m[3] ?? m[4] ?? m[5] ?? "";
      attrs.set(attrName, value);
    }
  }

  return { name, isClosing, isSelfClosing, attrs };
}

// Build a sanitized open tag string for an allowed element, or null to drop it.
function buildOpenTag(tag: ParsedTag): string | null {
  if (tag.name === "a") {
    const href = tag.attrs.has("href")
      ? sanitizeHref(tag.attrs.get("href") ?? "")
      : null;
    if (href === null) {
      // Anchor with no safe href: render as a plain span so its text stays.
      return "<span>";
    }
    return `<a href="${href}" rel="noopener noreferrer nofollow" target="_blank">`;
  }
  // All other allowed tags: emit with NO attributes (drop class/style/on*/etc).
  return `<${tag.name}>`;
}

// Find the index of the `>` that closes a tag starting at `from`, skipping any
// `>` that appears inside a single- or double-quoted attribute value. This is
// what stops `href="data:...<script>..."` from terminating the tag early.
function findTagEnd(source: string, from: number): number {
  let quote: '"' | "'" | null = null;
  for (let j = from; j < source.length; j += 1) {
    const ch = source[j];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ">") return j;
  }
  return -1;
}

/**
 * Sanitize an untrusted HTML string down to a strict allowlist of formatting
 * tags and safe links. The result is safe to assign to `innerHTML`.
 */
export function sanitizeHtml(input: string): string {
  if (!input) return "";
  const source = stripComments(input);
  let out = "";
  let i = 0;
  const len = source.length;
  // Stack of open allowed tags we have emitted (for matching close tags).
  const openStack: string[] = [];
  // When > 0, we are inside a drop-content element and skip everything.
  let dropDepth = 0;
  let dropTagName: string | null = null;

  while (i < len) {
    const lt = source.indexOf("<", i);
    if (lt === -1) {
      if (dropDepth === 0) out += escapeText(source.slice(i));
      break;
    }
    // Text before the next tag.
    if (lt > i) {
      if (dropDepth === 0) out += escapeText(source.slice(i, lt));
    }
    // A real tag opens with `<` immediately followed by a name char, `/`, `!`,
    // or `?`. Anything else (e.g. `< b`, `a < b`) is a literal `<` in text.
    const next = source[lt + 1];
    if (!next || !/[a-zA-Z/!?]/.test(next)) {
      if (dropDepth === 0) out += escapeText("<");
      i = lt + 1;
      continue;
    }
    const gt = findTagEnd(source, lt + 1);
    if (gt === -1) {
      // Unterminated `<`: treat the remainder as literal text.
      if (dropDepth === 0) out += escapeText(source.slice(lt));
      break;
    }
    const inner = source.slice(lt + 1, gt);
    i = gt + 1;

    // `<!doctype ...>` / processing instructions: drop the tag entirely.
    if (inner.startsWith("!") || inner.startsWith("?")) {
      continue;
    }

    const tag = parseTag(inner);
    if (!tag) {
      // Not a real tag (e.g. `< b`): emit the literal text so it is visible.
      if (dropDepth === 0) out += escapeText(source.slice(lt, gt + 1));
      continue;
    }

    // Inside a drop-content subtree: only watch for its matching close tag.
    if (dropDepth > 0) {
      if (DROP_CONTENT_TAGS.has(tag.name)) {
        if (tag.isClosing) {
          if (tag.name === dropTagName) {
            dropDepth -= 1;
            if (dropDepth === 0) dropTagName = null;
          }
        } else if (!tag.isSelfClosing) {
          dropDepth += 1;
        }
      }
      continue;
    }

    if (DROP_CONTENT_TAGS.has(tag.name)) {
      if (
        !tag.isClosing &&
        !tag.isSelfClosing &&
        !VOID_DROP_TAGS.has(tag.name)
      ) {
        dropDepth = 1;
        dropTagName = tag.name;
      }
      // Void drop tags, stray closing tags, and self-closing drop tags emit
      // nothing themselves but do not swallow following content.
      continue;
    }

    if (!ALLOWED_TAGS.has(tag.name)) {
      // Unknown but harmless-shaped tag: drop the tag, keep its children.
      continue;
    }

    if (tag.isClosing) {
      if (VOID_TAGS.has(tag.name)) continue;
      // Close down to the matching open tag, if any.
      const idx = openStack.lastIndexOf(tag.name);
      if (idx === -1) continue; // no matching open tag: drop stray close
      while (openStack.length > idx) {
        const name = openStack.pop() as string;
        out += `</${name}>`;
      }
      continue;
    }

    // Opening (or self-closing) allowed tag.
    const open = buildOpenTag(tag);
    if (open === null) continue;
    out += open;
    const renderedName = open.startsWith("<span>") ? "span" : tag.name;
    if (VOID_TAGS.has(tag.name)) continue;
    if (tag.isSelfClosing) {
      out += `</${renderedName}>`;
      continue;
    }
    // Track the rendered element name (anchors with bad href became spans).
    openStack.push(renderedName);
  }

  // Close any tags left open by malformed input.
  while (openStack.length > 0) {
    const name = openStack.pop() as string;
    out += `</${name}>`;
  }

  return out;
}

// Heuristic: does this content contain HTML markup we should sanitize+render,
// versus plain text we should render with newline preservation? Remote
// ActivityPub Notes deliver HTML; local Notes are authored as plain text.
const HTML_TAG_RE =
  /<\/?(p|br|a|span|em|strong|b|i|u|ul|ol|li|blockquote|code|pre|div|img|h[1-6]|table)\b[^>]*>/i;

export function looksLikeHtml(content: string): boolean {
  return HTML_TAG_RE.test(content);
}
