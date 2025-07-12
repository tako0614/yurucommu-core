import DOMPurify from "npm:dompurify";

const ALLOWED_TAGS = [
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
];

const ALLOWED_ATTRS: Record<string, string[]> = {
  a: ["href", "rel", "target", "class"],
  span: ["class"],
};
const GLOBAL_ATTRS = ["data-og", "lang"];
const ALLOWED_CLASSES = ["invisible", "ellipsis", "hashtag", "mention"];

export function sanitizeHtml(fragment: string): string {
  const clean = DOMPurify.sanitize(fragment, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: [
      ...new Set(Object.values(ALLOWED_ATTRS).flat().concat(GLOBAL_ATTRS)),
    ],
    ALLOW_DATA_ATTR: false,
    RETURN_DOM: true,
  }) as unknown as Document;

  const walker = clean.createTreeWalker(clean.body, NodeFilter.SHOW_ELEMENT);
  while (walker.nextNode()) {
    const el = walker.currentNode as Element;
    const tag = el.tagName.toLowerCase();
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const allowed = (ALLOWED_ATTRS[tag] ?? []).includes(name) ||
        GLOBAL_ATTRS.includes(name);
      if (!allowed) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (name === "href" && /^(javascript|data):/i.test(attr.value)) {
        el.removeAttribute(attr.name);
      } else if (name === "class") {
        const filtered = Array.from(el.classList).filter((c) =>
          ALLOWED_CLASSES.includes(c)
        );
        if (filtered.length) el.className = filtered.join(" ");
        else el.removeAttribute("class");
      }
    }
  }
  return clean.body.innerHTML;
}

export function renderHtml(content: string): string {
  const clean = sanitizeHtml(content);
  const doc = new DOMParser().parseFromString(
    `<div id='root'>${clean}</div>`,
    "text/html",
  );
  const root = doc.getElementById("root")!;

  let firstExternal: string | null = null;

  for (const a of Array.from(root.querySelectorAll("a"))) {
    const spans = Array.from(a.querySelectorAll("span"));
    if (
      spans.length === 3 &&
      spans[0].classList.contains("invisible") &&
      spans[2].classList.contains("ellipsis")
    ) {
      a.setAttribute("data-shortlink", "");
    }
    if (a.classList.contains("hashtag")) {
      const tag = a.textContent?.replace(/^#/, "") ?? "";
      a.setAttribute("href", `/tags/${encodeURIComponent(tag)}`);
    }
    if (!firstExternal && /^https?:\/\//.test(a.getAttribute("href") ?? "")) {
      firstExternal = a.getAttribute("href")!;
    }
  }

  if (firstExternal && !root.querySelector("[data-og]")) {
    const div = doc.createElement("div");
    div.setAttribute("data-og", firstExternal);
    root.appendChild(div);
  }

  return root.innerHTML;
}
