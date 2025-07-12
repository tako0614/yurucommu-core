import MarkdownIt from "markdown-it";
import LinkifyIt from "linkify-it";
import createDOMPurify from "dompurify";
import type { DOMPurify } from "dompurify";

// --- 型定義 ----------------------------------------------------------
export interface APTag {
  type: "Mention" | "Hashtag" | "Emoji" | string;
  name?: string;
  href?: string;
  icon?: {
    type: string;
    mediaType?: string;
    url: string;
  };
}

export interface APNote {
  content: string;
  source?: {
    content: string;
    mediaType?: string;
  };
  tag?: APTag[];
}

export interface RenderOptions {
  /** ハッシュタグ URLが無い場合のフォールバック先 (例: "/tags/") */
  hashHostFallback?: string;
  /** 既存の DOMPurify インスタンスを注入したい場合 */
  DOMPurify?: DOMPurify;
  /** DOMPurify の追加設定 */
  purifierConfig?: import("npm:dompurify").Config;
  /** 長い URL を省略表示するか */
  shortenLink?: boolean;
}

// --- ユーティリティ --------------------------------------------------
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function plainTextToHtml(text: string): string {
  return escapeHtml(text).replace(/\r?\n/g, "<br>");
}

const INVISIBLE_CLS = "invisible";
const ELLIPSIS_CLS = "ellipsis";
const MAX_VISIBLE = 45;

function linkifyUrls(text: string, linkify: LinkifyIt, shorten = true): string {
  let out = "";
  let last = 0;
  for (const m of linkify.match(text) ?? []) {
    out += escapeHtml(text.slice(last, m.index));

    const url = m.url;
    const protocol = url.match(/^[a-z][\w.+-]*:\/\//i)?.[0] ?? "";
    const body = url.slice(protocol.length);

    let inner: string;
    if (!shorten || url.length <= MAX_VISIBLE) {
      inner = escapeHtml(url);
    } else {
      const visible = body.slice(0, MAX_VISIBLE) + "…";
      const hidden = body.slice(MAX_VISIBLE);
      inner = `<span class="${INVISIBLE_CLS}">${escapeHtml(protocol)}</span>` +
        `<span class="${ELLIPSIS_CLS}">${escapeHtml(visible)}</span>` +
        `<span class="${INVISIBLE_CLS}">${escapeHtml(hidden)}</span>`;
    }

    out += `<a href="${
      escapeHtml(url)
    }" class="external-link" target="_blank" rel="noopener noreferrer nofollow">${inner}</a>`;
    last = m.lastIndex;
  }
  out += escapeHtml(text.slice(last));
  return out;
}

// --- 本体 ------------------------------------------------------------
export function renderNoteContent(
  note: APNote,
  opts: RenderOptions = {},
): string {
  // Linkifier インスタンス
  const linkify = new LinkifyIt();

  // DOMPurify インスタンスの決定 (オプション指定 > ブラウザ global > 自動生成)
  const purifier: DOMPurify = (() => {
    if (opts.DOMPurify) return opts.DOMPurify;
    if (
      typeof (globalThis as unknown as { DOMPurify?: DOMPurify }).DOMPurify !==
        "undefined"
    ) {
      return (globalThis as unknown as { DOMPurify: DOMPurify }).DOMPurify;
    }
    if (typeof window !== "undefined") {
      // ブラウザ環境なら createDOMPurify で生成
      return createDOMPurify(window);
    }
    throw new Error(
      "DOMPurify instance not found. Provide via options.DOMPurify or ensure DOM environment.",
    );
  })();

  // 1) rawHtml を生成 --------------------------------------------------
  let rawHtml: string;

  if (note.source?.mediaType?.toLowerCase().startsWith("text/markdown")) {
    const md = new MarkdownIt({ linkify: false, breaks: true });
    rawHtml = md.render(note.source.content);
  } else if (/<[a-z][\s\S]*>/i.test(note.content)) {
    // 既に HTML フラグメント
    rawHtml = note.content;
  } else {
    // プレーンテキスト
    rawHtml = plainTextToHtml(note.content);
  }

  // 2) DOM 上でリンク化 / 絵文字展開 ----------------------------------
  const doc = document.implementation.createHTMLDocument("");
  doc.body.innerHTML = rawHtml;

  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let current: Node | null;
  while ((current = walker.nextNode())) {
    if (current.textContent?.trim()) textNodes.push(current as Text);
  }

  for (const tNode of textNodes) {
    // <a> / <code> / <pre> 直下は触らない
    if (tNode.parentElement?.closest("a, code, pre")) continue;

    let txt = tNode.data;
    let replaced = false;

    // 1) URL を先にリンク化（ネスト防止）
    if (linkify.pretest(txt)) {
      txt = linkifyUrls(txt, linkify, opts.shortenLink !== false);
      replaced = true;
    }

    // 2) カスタム絵文字
    for (const tag of note.tag ?? []) {
      if (tag.type === "Emoji" && tag.name && tag.icon?.url) {
        const re = new RegExp(
          tag.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          "g",
        );
        if (re.test(txt)) {
          replaced = true;
          const img = `<img src="${escapeHtml(tag.icon.url)}" alt="${
            escapeHtml(tag.name)
          }" class="emoji" loading="lazy" />`;
          txt = txt.replace(re, img);
        }
      }
    }

    // 3) メンション / ハッシュタグ
    for (const tag of note.tag ?? []) {
      if (
        (tag.type === "Mention" || tag.type === "Hashtag") && tag.name &&
        tag.href
      ) {
        const re = new RegExp(
          tag.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          "g",
        );
        if (re.test(txt)) {
          replaced = true;
          const cls = tag.type === "Mention" ? "mention" : "mention hashtag";
          const relAttr = tag.type === "Hashtag" ? ' rel="tag"' : "";
          txt = txt.replace(
            re,
            () =>
              `<a href="${
                escapeHtml(tag.href!)
              }" class="${cls}"${relAttr} target="_blank">${
                escapeHtml(tag.name!)
              }</a>`,
          );
        }
      }
    }

    if (replaced) {
      const span = doc.createElement("span");
      span.innerHTML = txt;
      tNode.replaceWith(...Array.from(span.childNodes));
    }
  }

  // 3) DOMPurify サニタイズ ------------------------------------------
  const safeHtml = purifier.sanitize(doc.body.innerHTML, {
    ...opts.purifierConfig,
    ALLOWED_TAGS: [
      "p",
      "br",
      "a",
      "span",
      "em",
      "strong",
      "code",
      "pre",
      "ul",
      "ol",
      "li",
      "blockquote",
      "img",
    ],
    ALLOWED_ATTR: [
      "href",
      "rel",
      "target",
      "class",
      "src",
      "alt",
      "title",
      "loading",
    ],
    ALLOW_DATA_ATTR: false,
    ALLOWED_URI_REGEXP:
      /^(?:(?:https?|mailto|data):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
    RETURN_TRUSTED_TYPE: false,
  });

  return safeHtml.toString();
}
