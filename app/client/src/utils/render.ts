import DOMPurify from "dompurify";
import linkifyHtml from "linkify-html";

// ------------------------------
// 1) ホワイトリスト & 定数
// ------------------------------
const ALLOWED_TAGS = [
  "p", "br", "a", "span", "em", "strong", "code", "pre", "ul", "ol", "li", "blockquote",
];

const ALLOWED_ATTRS: Record<string, string[]> = {
  a: ["href", "rel", "target", "class"],
  span: ["class"],
};

const GLOBAL_ATTRS = ["data-og", "lang"];
const ALLOWED_CLASSES = [
  "invisible",
  "ellipsis",
  "hashtag",
  "mention",
  "external-link",
] as const;
const HASH_HOST_FALLBACK = "/tags/"; // href 不明ハッシュタグのフォールバック

// 疑似属性フラグメント検出用 — ‘" class="foo"&gt;’ 等
const ATTR_FRAGMENT_RE = /^\s*["'”’]\s*(?:target|rel|class|href|translate)=|&gt;$/i;

// 空白判定 (= nbsp 含む)
const BLANK_RE = /^[\u00A0\s]*$/;

// ------------------------------
// 2) サニタイズ (DOMPurify)
// ------------------------------
export function sanitizeHtml(fragment: string): string {
  const clean = DOMPurify.sanitize(fragment, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: [...new Set(Object.values(ALLOWED_ATTRS).flat().concat(GLOBAL_ATTRS))],
    ALLOW_DATA_ATTR: true, // data-og 用
    RETURN_DOM_FRAGMENT: true,
  }) as unknown as DocumentFragment;

  // 属性フィルタ／class 絞り込み
  const walk = document.createTreeWalker(clean, NodeFilter.SHOW_ELEMENT);
  while (walk.nextNode()) {
    const el = walk.currentNode as Element;
    const tag = el.tagName.toLowerCase();
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const allowed =
        (ALLOWED_ATTRS[tag] ?? []).includes(name) ||
        GLOBAL_ATTRS.includes(name) ||
        name === "data-og";
      if (!allowed) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (name === "href" && /^(javascript|data):/i.test(attr.value)) el.removeAttribute(attr.name);
      else if (name === "class") {
        const kept = Array.from(el.classList).filter((c) => ALLOWED_CLASSES.includes(c as typeof ALLOWED_CLASSES[number]));
        kept.length ? (el.className = kept.join(" ")) : el.removeAttribute("class");
      }
      // rel属性の値を検証し、不正な場合は削除
      else if (name === "rel") {
        // rel属性の値が、英数字、スペース、ハイフン以外の文字を含む場合、不正と判断し削除
        if (/[^a-zA-Z0-9\s-]/.test(attr.value)) {
          el.removeAttribute(attr.name);
        }
      }
    }
  }
  const tmp = document.createElement("div");
  tmp.appendChild(clean);
  return tmp.innerHTML;
}

// ------------------------------
// 3) メイン描画
// ------------------------------
export function renderHtml(raw: string): string {
  const sanitized = sanitizeHtml(raw);
  const doc = new DOMParser().parseFromString(`<div id="root">${sanitized}</div>`, "text/html");
  const root = doc.getElementById("root")!;

  // util --------------------------------------------------------
  const unwrap = (el: Element, keepSpace = true) => {
    const frag = doc.createDocumentFragment();
    if (keepSpace) {
      const prev = el.previousSibling;
      if (prev && prev.nodeType === 3 && !/\s$/.test(prev.textContent || "")) frag.append(" ");
    }
    while (el.firstChild) frag.append(el.firstChild);
    if (keepSpace) {
      const next = el.nextSibling;
      if (next && next.nodeType === 3 && !/^\s/.test(next.textContent || "")) frag.append(" ");
    }
    el.replaceWith(frag);
  };
  const isSafeUrl = (href = "") => /^(https?|gemini|ipfs|dat|mailto):/i.test(href);

  const removeWithTrailingSpace = (node: Node) => {
    let n = node.nextSibling;
    while (n && n.nodeType === 3 && BLANK_RE.test(n.textContent || "")) {
      const rm = n;
      n = n.nextSibling;
      rm.parentNode?.removeChild(rm);
    }
    node.parentNode?.removeChild(node);
  };

  // ------------------------------
  // 3-A. 壊れ <a> + Mastodon #タグ二重化 → 正規化
  // ------------------------------
  // 3-A.1 basic link sanity checks (v6)
  root.querySelectorAll<HTMLAnchorElement>("a").forEach((a) => {
    const href = a.getAttribute("href") ?? "";

    // A-1) href が `<a href` を含む → unwrap
    if (href.startsWith("&lt;a href")) return unwrap(a);

    // A-2) span.invisible に入れ子 anchor がある場合は unwrap
    if (a.parentElement?.classList.contains("invisible")) return unwrap(a);

    // A-3) 不正 URL → unwrap
    if (!isSafeUrl(href) || href.includes("<") || href.includes("&lt;")) return unwrap(a);
  });

  // 3-A.1b: 破損したタグリンクの修正
  root.querySelectorAll<HTMLAnchorElement>("a").forEach((a) => {
    // 無効な 'ef' 属性を修正
    if (a.hasAttribute("ef")) {
      const efValue = a.getAttribute("ef");
      if (efValue && !a.hasAttribute("href")) {
        a.setAttribute("href", efValue);
      }
      a.removeAttribute("ef");
    }

    // 'external-lig' クラスを修正
    if (a.classList.contains("external-lig")) {
      a.classList.remove("external-lig");
      a.classList.add("external-link");
    }
  });

  // 3-A.2 Mastodon 外部リンク/ハッシュタグ正規化
  const seenSlug = new Set<string>();
  root.querySelectorAll<HTMLAnchorElement>("a.mention.hashtag").forEach((mention) => {
    const mentionHref = mention.getAttribute("href") || "";
    const slugMatch = mentionHref.match(/\/tags\/([^/?#]+)/);
    if (!slugMatch) return;
    const slug = decodeURIComponent(slugMatch[1]);

    // 直前の要素が重複する external-link なら削除
    let prev = mention.previousSibling;
    while (prev && prev.nodeType === 3 && BLANK_RE.test(prev.textContent || "")) {
      prev = prev.previousSibling;
    }

    if (prev && prev.nodeType === 1 && (prev as Element).matches("a.external-link")) {
      const prevHref = (prev as Element).getAttribute("href") || "";
      const prevSlugMatch = prevHref.match(/\/tags\/([^/?#]+)/);
      if (prevSlugMatch && decodeURIComponent(prevSlugMatch[1]) === slug) {
        removeWithTrailingSpace(prev);
      }
    }
  });

  // 3-A.3 #タグ重複除去 (slug ベース)
  root.querySelectorAll<HTMLAnchorElement>("a.mention.hashtag").forEach((tag) => {
    const href = tag.getAttribute("href") || "";
    const slug = href.startsWith("/tags/") ? decodeURIComponent(href.slice(6)) : href;
    if (seenSlug.has(slug)) {
      removeWithTrailingSpace(tag);
    } else {
      seenSlug.add(slug);
    }
  });

  // A-tail) span.invisible / span.ellipsis の孤立 URL 断片掃除 (v6)
  root.querySelectorAll("span.invisible, span.ellipsis").forEach((sp) => {
    if (sp.querySelector("a")) sp.remove();
    else if (!sp.textContent?.trim()) sp.remove();
  });

  // 3-A.6 stray-url-fragments (v6)
  root.querySelectorAll("span.invisible").forEach((inv) => {
    if (inv.parentElement?.tagName === "A") return; // 既にリンク内 → 正常
    if (!/^https?:\/\//.test(inv.textContent ?? "")) return; // URL っぽくない

    const bundle: Node[] = [inv];
    let n = inv.nextSibling;
    while (
      n &&
      n.nodeType === 1 &&
      (n as HTMLElement).tagName === "SPAN" &&
      ((n as HTMLElement).classList.contains("ellipsis") ||
        (n as HTMLElement).classList.contains("invisible"))
    ) {
      bundle.push(n);
      n = n.nextSibling;
    }

    const urlTxt = bundle.map((b) => b.textContent ?? "").join("");
    try {
      new URL(urlTxt);
      bundle.forEach((b) => (b as HTMLElement).remove());
    } catch {
      /* ただのテキストなら残す */
    }
  });

  // 3-A.5 attr-scrub (v6)
  const attrWalker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const attrGarbage: Node[] = [];
  while (attrWalker.nextNode()) {
    const tn = attrWalker.currentNode;
    if (ATTR_FRAGMENT_RE.test(tn.textContent || "")) attrGarbage.push(tn);
  }
  attrGarbage.forEach((n) => n.parentNode?.removeChild(n));

  // ------------------------------
  // 3-B. 裸 '#<span>タグ</span>' → アンカー化 (v6)
  // ------------------------------
  const spanWalker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let tn: Node | null;
  while ((tn = spanWalker.nextNode())) {
    if ((tn.textContent || "").trim() === "#" && tn.nextSibling?.nodeType === 1) {
      const tagSpan = tn.nextSibling as HTMLElement;
      if (tagSpan.tagName === "SPAN" && tagSpan.textContent?.trim()) {
        const tagText = tagSpan.textContent.trim();
        const anchor = doc.createElement("a");
        anchor.className = "mention hashtag";
        anchor.setAttribute("rel", "tag");
        anchor.setAttribute("href", HASH_HOST_FALLBACK + encodeURIComponent(tagText));
        anchor.append("#", tagSpan.cloneNode(true));
        tagSpan.parentNode?.insertBefore(anchor, tn);
        tagSpan.remove();
        tn.parentNode?.removeChild(tn);
      }
    }
  }

  // 3-B.2 orphan <span>tag</span> → アンカー化 (v6)
  root.querySelectorAll("span:not([class])").forEach((sp) => {
    const txt = sp.textContent?.trim() ?? "";
    if (!txt) return;
    if (sp.parentElement?.tagName === "A") return; // 既にリンク化済み
    if (!/^[\p{L}\p{N}_\-]{1,50}$/u.test(txt)) return; // 記号などは除外

    const a = doc.createElement("a");
    a.className = "mention hashtag";
    a.setAttribute("rel", "tag");
    a.setAttribute("href", HASH_HOST_FALLBACK + encodeURIComponent(txt));
    a.append("#", sp.cloneNode(true));
    sp.replaceWith(a);
  });

  // ------------------------------
  // 3-C. linkify (裸 http[s]://) (v6)
  // ------------------------------
  const linkWalker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Node[] = [];
  while ((tn = linkWalker.nextNode())) textNodes.push(tn);

  textNodes.forEach((t) => {
    if ((t as HTMLElement).parentElement?.tagName === "A") return;
    const src = t.textContent || "";
    if (!src.trim()) return;
    const html = linkifyHtml(src, {
      target: "_blank",
      rel: "noopener noreferrer",
      className: "external-link",
      validate: { url: (v: string) => /^https?:/.test(v) },
    });
    if (html !== src) {
      const frag = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html").body;
      (t as HTMLElement).replaceWith(...Array.from(frag.childNodes));
    }
  });

  // ------------------------------
  // 3-D. Mastodon 互換短縮表示 (v6)
  // ------------------------------
  root.querySelectorAll<HTMLAnchorElement>("a").forEach((a) => {
    const href = a.getAttribute("href") || "";
    if (!href.startsWith("http")) return;
    if (a.querySelector("span.ellipsis")) return;
    const raw = a.textContent?.trim() ?? "";
    if (raw && raw !== href) return;

    let url: URL;
    try {
      url = new URL(href);
    } catch {
      return;
    }

    a.textContent = "";
    const inv1 = doc.createElement("span");
    inv1.className = "invisible";
    inv1.textContent = `${url.protocol}//`;

    const ell = doc.createElement("span");
    ell.className = "ellipsis";
    const disp = url.host + url.pathname;
    ell.textContent = disp.length > 30 ? disp.slice(0, 27) + "…" : disp;

    const inv2 = doc.createElement("span");
    inv2.className = "invisible";
    inv2.textContent = disp.slice(ell.textContent.endsWith("…") ? 27 : disp.length) + url.search + url.hash;

    a.append(inv1, ell, inv2);
  });

  // ------------------------------
  // 3-E. data-og 付与（最初の外部リンク） (v6)
  // ------------------------------
  const og = root.querySelector<HTMLAnchorElement>("a.external-link[href^='http']")?.href;
  if (og && !root.querySelector("[data-og]")) {
    const d = doc.createElement("div");
    d.setAttribute("data-og", og);
    root.appendChild(d);
  }

  return root.innerHTML;
}
