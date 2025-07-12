/**
 * ActivityPub Note content renderer
 * ---------------------------------
 * 使用例:
 *   import { renderNoteContent } from "./renderNoteContent.ts";
 *   const html = renderNoteContent(noteObj);
 *   element.innerHTML = html; // DOMPurify 済みなので安全に挿入できます。
 *
 * 依存ライブラリ（ブラウザ / Deno 共用）
 *   - dompurify   (npm:dompurify)  → 型も含む
 *   - markdown-it (npm:markdown-it)
 *   - linkify-it  (npm:linkify-it)
 *
 * Deno なら import specifier を npm:〜 に書き換えてそのまま利用可能です。
 */

import MarkdownIt from "npm:markdown-it";
import LinkifyIt from "npm:linkify-it";
import createDOMPurify from "npm:dompurify";
import type { DOMPurify } from "npm:dompurify";

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

function linkifyUrls(text: string, linkify: LinkifyIt): string {
  let out = "";
  let last = 0;
  const matches = linkify.match(text) ?? [];
  for (const m of matches) {
    out += escapeHtml(text.slice(last, m.index));
    const url = m.url;
    const display = url.length > 48 ? `${url.slice(0, 45)}…` : url;
    out += `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer nofollow" class="external-link">${escapeHtml(display)}</a>`;
    last = m.lastIndex;
  }
  out += escapeHtml(text.slice(last));
  return out;
}

// --- 本体 ------------------------------------------------------------
export function renderNoteContent(note: APNote, opts: RenderOptions = {}): string {
  // Linkifier インスタンス
  const linkify = new LinkifyIt();

  // DOMPurify インスタンスの決定 (オプション指定 > ブラウザ global > 自動生成)
  const purifier: DOMPurify = (() => {
    if (opts.DOMPurify) return opts.DOMPurify;
    if (typeof (globalThis as unknown as { DOMPurify?: DOMPurify }).DOMPurify !== "undefined") {
      return (globalThis as unknown as { DOMPurify: DOMPurify }).DOMPurify;
    }
    if (typeof window !== "undefined") {
      // ブラウザ環境なら createDOMPurify で生成
      return createDOMPurify(window);
    }
    throw new Error("DOMPurify instance not found. Provide via options.DOMPurify or ensure DOM environment.");
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
    let txt = tNode.data;
    let replaced = false;

    // カスタム絵文字置換
    for (const tag of note.tag ?? []) {
      if (tag.type === "Emoji" && tag.name && tag.icon?.url) {
        const re = new RegExp(tag.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
        if (re.test(txt)) {
          replaced = true;
          const img = `<img src="${escapeHtml(tag.icon.url)}" alt="${escapeHtml(tag.name)}" class="emoji" loading="lazy" />`;
          txt = txt.replace(re, img);
        }
      }
    }

    // メンション / ハッシュタグ
    for (const tag of note.tag ?? []) {
      if ((tag.type === "Mention" || tag.type === "Hashtag") && tag.name && tag.href) {
        const re = new RegExp(tag.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
        if (re.test(txt)) {
          replaced = true;
          const cls = tag.type === "Mention" ? "mention" : "mention hashtag";
          const relAttr = tag.type === "Hashtag" ? " rel=\"tag\"" : "";
          txt = txt.replace(re, () => `<a href="${escapeHtml(tag.href!)}" class="${cls}"${relAttr} target="_blank">${escapeHtml(tag.name!)}</a>`);
        }
      }
    }

    // URL 自動リンク化
    if (linkify.pretest(txt)) {
      replaced = true;
      txt = linkifyUrls(txt, linkify);
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
      "p", "br", "a", "span", "em", "strong", "code", "pre", "ul", "ol", "li", "blockquote", "img",
    ],
    ALLOWED_ATTR: [
      "href", "rel", "target", "class", "src", "alt", "title", "loading",
    ],
    ALLOW_DATA_ATTR: false,
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|data):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
    RETURN_TRUSTED_TYPE: false,
  });

  return safeHtml.toString();
}
