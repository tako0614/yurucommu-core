export function sanitizeHTML(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (!doc) return "";
  for (const el of doc.querySelectorAll("script,style")) {
    el.remove();
  }
  for (const el of doc.querySelectorAll("*")) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on")) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (
        (name === "src" || name === "href") &&
        attr.value.trim().startsWith("javascript:")
      ) {
        el.removeAttribute(attr.name);
      }
    }
  }
  return doc.body.innerHTML;
}
