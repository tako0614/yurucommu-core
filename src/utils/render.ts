import { sanitizeHtml } from "./sanitize.ts";
import { parseHTML } from "npm:linkedom";

export function render(content: string): TrustedHTML {
  const clean = sanitizeHtml(content) as unknown as string;
  const { document } = parseHTML(`<div id='root'>${clean}</div>`);
  const root = document.getElementById("root")!;

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
    const div = document.createElement("div");
    div.setAttribute("data-og", firstExternal);
    root.appendChild(div);
  }

  return root.innerHTML as unknown as TrustedHTML;
}
