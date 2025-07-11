export function sanitizeHTML(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (!doc) return "";
  for (const el of Array.from(doc.querySelectorAll("script,style"))) {
    el.remove();
  }
  for (const el of Array.from(doc.querySelectorAll("*"))) {
    for (const attr of Array.from(el.attributes) as Attr[]) {
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
  const cleaned = doc.body.innerHTML;
  return cleaned.replace(
    /(https?:\/\/[^\s]+)/g,
    (m) =>
      `<a href="${m}" class="text-blue-400 underline" target="_blank" rel="noopener noreferrer">${m}</a>`,
  );
}
