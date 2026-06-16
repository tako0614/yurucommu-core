import { assert, assertEquals, assertFalse } from "#test/assert";
import { test } from "bun:test";
import { looksLikeHtml, sanitizeHtml } from "./sanitize-html.ts";

// --- XSS vectors: dangerous content must never survive ---

test("sanitizeHtml - drops <script> tags and their contents", () => {
  const out = sanitizeHtml(`<p>hi</p><script>alert(1)</script>`);
  assertFalse(out.includes("<script"), "script tag must be removed");
  assertFalse(out.includes("alert(1)"), "script body must be removed");
  assertEquals(out, "<p>hi</p>");
});

test("sanitizeHtml - drops <style> tag bodies", () => {
  const out = sanitizeHtml(`<style>body{display:none}</style><p>x</p>`);
  assertFalse(out.includes("display:none"), "style body must be removed");
  assertEquals(out, "<p>x</p>");
});

test("sanitizeHtml - removes <img onerror> entirely (img not allowlisted)", () => {
  const out = sanitizeHtml(`<img src="x" onerror="alert(1)">text`);
  assertFalse(out.toLowerCase().includes("onerror"), "no event handler");
  assertFalse(out.includes("<img"), "img is not allowlisted");
  assertEquals(out, "text");
});

test("sanitizeHtml - drops javascript: hrefs (anchor becomes span)", () => {
  const out = sanitizeHtml(`<a href="javascript:alert(1)">click</a>`);
  assertFalse(out.toLowerCase().includes("javascript:"), "no js scheme");
  assertFalse(out.includes("href"), "unsafe anchor keeps no href");
  assertEquals(out, "<span>click</span>");
});

test("sanitizeHtml - drops obfuscated javascript: hrefs", () => {
  const vectors = [
    `<a href="JaVaScRiPt:alert(1)">a</a>`,
    `<a href="java\tscript:alert(1)">a</a>`,
    `<a href="java\nscript:alert(1)">a</a>`,
    `<a href=" javascript:alert(1)">a</a>`,
    `<a href="javascript&colon;alert(1)">a</a>`,
    `<a href="&#106;avascript:alert(1)">a</a>`,
  ];
  for (const v of vectors) {
    const out = sanitizeHtml(v);
    assertFalse(
      out.toLowerCase().includes("javascript") && out.includes("href"),
      `vector must not yield a javascript href: ${v} -> ${out}`,
    );
    assertEquals(out, "<span>a</span>");
  }
});

test("sanitizeHtml - drops data: and vbscript: hrefs", () => {
  const data = sanitizeHtml(`<a href="data:text/html,<script>1</script>">x</a>`);
  assertFalse(data.includes("data:"), "no data uri");
  assertFalse(data.includes("href"), "no href kept");

  const vb = sanitizeHtml(`<a href="vbscript:msgbox(1)">x</a>`);
  assertFalse(vb.toLowerCase().includes("vbscript:"), "no vbscript uri");
  assertEquals(vb, "<span>x</span>");
});

test("sanitizeHtml - strips on* event handler attributes from allowed tags", () => {
  const out = sanitizeHtml(`<p onclick="evil()" onmouseover="x()">hi</p>`);
  assertFalse(out.toLowerCase().includes("onclick"), "no onclick");
  assertFalse(out.toLowerCase().includes("onmouseover"), "no onmouseover");
  assertEquals(out, "<p>hi</p>");
});

test("sanitizeHtml - strips onload and other handlers on span", () => {
  const out = sanitizeHtml(`<span onload="alert(1)">y</span>`);
  assertFalse(out.toLowerCase().includes("onload"), "no onload");
  assertEquals(out, "<span>y</span>");
});

test("sanitizeHtml - strips style attributes (incl. expression())", () => {
  const out = sanitizeHtml(
    `<p style="width:expression(alert(1));color:red">z</p>`,
  );
  assertFalse(out.toLowerCase().includes("style"), "no style attr");
  assertFalse(out.toLowerCase().includes("expression"), "no expression");
  assertEquals(out, "<p>z</p>");
});

test("sanitizeHtml - strips class attributes", () => {
  const out = sanitizeHtml(`<p class="evil">w</p>`);
  assertFalse(out.includes("class"), "class attr removed");
  assertEquals(out, "<p>w</p>");
});

test("sanitizeHtml - drops iframe/object/embed and bodies", () => {
  const out = sanitizeHtml(
    `<iframe src="evil"></iframe><object data="x"></object><embed src="y">ok`,
  );
  assertFalse(out.includes("<iframe"), "no iframe");
  assertFalse(out.includes("<object"), "no object");
  assertFalse(out.includes("<embed"), "no embed");
  assertEquals(out, "ok");
});

test("sanitizeHtml - HTML comments cannot smuggle markup", () => {
  const out = sanitizeHtml(`<!-- <script>alert(1)</script> --><p>safe</p>`);
  assertFalse(out.includes("script"), "commented script gone");
  assertEquals(out, "<p>safe</p>");
});

test("sanitizeHtml - nested/broken tags do not break out", () => {
  const out = sanitizeHtml(
    `<p><b>bold <i>italic</b> still</i></p><div><script>x`,
  );
  // No script and no div survive; allowed tags are balanced on output.
  assertFalse(out.includes("<script"), "no script");
  assertFalse(out.includes("<div"), "div not allowlisted");
  // Output is well-formed (every opened allowed tag is closed).
  assert(out.startsWith("<p>"), "starts with p");
  assert(out.trim().endsWith("</p>"), "p is closed at the end");
});

test("sanitizeHtml - stray < is escaped, not treated as a tag", () => {
  const out = sanitizeHtml(`a < b and c > d`);
  assert(out.includes("&lt;"), "lone < escaped");
  assertFalse(out.includes("<b"), "no spurious tag");
});

test("sanitizeHtml - text content is HTML-escaped", () => {
  const out = sanitizeHtml(`<p>1 & 2 &lt;x&gt;</p>`);
  assert(out.includes("&amp;"), "ampersand escaped");
});

// --- Allowed content survives ---

test("sanitizeHtml - allowed formatting tags survive", () => {
  const out = sanitizeHtml(
    `<p>hello <strong>world</strong> <em>x</em> <b>b</b> <i>i</i> <u>u</u></p>` +
      `<ul><li>one</li><li>two</li></ul><ol><li>a</li></ol>` +
      `<blockquote>q</blockquote><pre><code>code</code></pre>line<br>break`,
  );
  assert(out.includes("<strong>world</strong>"), "strong kept");
  assert(out.includes("<em>x</em>"), "em kept");
  assert(out.includes("<ul><li>one</li>"), "list kept");
  assert(out.includes("<blockquote>q</blockquote>"), "blockquote kept");
  assert(out.includes("<pre><code>code</code></pre>"), "pre/code kept");
  assert(out.includes("<br>"), "br kept");
});

test("sanitizeHtml - safe http(s) links survive with hardened rel/target", () => {
  const https = sanitizeHtml(`<a href="https://example.com/path?q=1">site</a>`);
  assert(https.includes(`href="https://example.com/path?q=1"`), "href kept");
  assert(https.includes(`rel="noopener noreferrer nofollow"`), "rel forced");
  assert(https.includes(`target="_blank"`), "target forced");
  assert(https.includes(">site</a>"), "anchor text kept");

  const http = sanitizeHtml(`<a href="http://example.org">x</a>`);
  assert(http.includes(`href="http://example.org"`), "http kept");

  const mailto = sanitizeHtml(`<a href="mailto:a@b.com">mail</a>`);
  assert(mailto.includes(`href="mailto:a@b.com"`), "mailto kept");
});

test("sanitizeHtml - quotes in href cannot break out of the attribute", () => {
  // Here `&quot;` is literal source text, so the whole string up to the real
  // closing quote is the href value. It must be emitted with no unescaped
  // quote (which would otherwise inject a separate `onmouseover` attribute).
  const out = sanitizeHtml(`<a href="https://e.com/&quot; onmouseover=x">y</a>`);
  assertFalse(out.includes(`" onmouseover`), "no attribute break-out");
  // The href value's own quote/lt/gt are escaped; the value stays inside href.
  assert(out.startsWith(`<a href="`), "single anchor open tag");
  assert(out.endsWith(">y</a>"), "single anchor with intact text");
  // Exactly one attribute-opening quote pair: count of `"` is even and the only
  // `=` characters are the attribute assignments we emit, not an injected one.
  const quoteCount = (out.match(/"/g) ?? []).length;
  assertEquals(quoteCount % 2, 0, "balanced quotes (no break-out)");
});

test("sanitizeHtml - a real second attribute after a closed quote is dropped", () => {
  // Now the href value closes cleanly; `onmouseover` is a separate attribute
  // and must be stripped (only href/rel/target survive on anchors).
  const out = sanitizeHtml(`<a href="https://e.com/" onmouseover="x">y</a>`);
  assertFalse(out.toLowerCase().includes("onmouseover"), "no injected attr");
  assertEquals(
    out,
    `<a href="https://e.com/" rel="noopener noreferrer nofollow" target="_blank">y</a>`,
  );
});

test("sanitizeHtml - empty and plain input", () => {
  assertEquals(sanitizeHtml(""), "");
  assertEquals(sanitizeHtml("just text"), "just text");
});

// --- looksLikeHtml heuristic ---

test("looksLikeHtml - detects markup, rejects plain text", () => {
  assert(looksLikeHtml("<p>hi</p>"), "p detected");
  assert(looksLikeHtml('<a href="https://x.com">l</a>'), "anchor detected");
  assert(looksLikeHtml("line<br>break"), "br detected");
  assertFalse(looksLikeHtml("just plain text"), "plain not html");
  assertFalse(looksLikeHtml("email a@b.com and 2 < 3"), "math not html");
  assertFalse(looksLikeHtml("@mention only"), "mention not html");
});
