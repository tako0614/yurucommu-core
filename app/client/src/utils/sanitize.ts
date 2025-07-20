import createDOMPurify from "dompurify";

const DOMPurify = createDOMPurify(window);

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
const ALLOWED_CLASSES = ["invisible", "hashtag", "mention"];

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
  return clean.body.innerHTML as string;
}
