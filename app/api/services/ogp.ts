import { DOMParser } from "https://deno.land/x/deno_dom/deno-dom-wasm.ts";

export interface OgpData {
  title?: string;
  description?: string;
  image?: string;
  url: string;
}

export async function fetchOgpData(url: string): Promise<OgpData | null> {
  try {
    const response = await fetch(url);
    const html = await response.text();
    const document = new DOMParser().parseFromString(html, "text/html");

    if (!document) {
      return null;
    }

    const getMetaContent = (
      doc: typeof document,
      property: string,
    ): string | undefined => {
      return doc.querySelector(`meta[property="${property}"]`)?.getAttribute(
        "content",
      ) ||
        doc.querySelector(`meta[name="${property}"]`)?.getAttribute(
          "content",
        ) ||
        undefined;
    };

    const title = getMetaContent(document, "og:title") ||
      document.querySelector("title")?.textContent ||
      undefined;
    const description = getMetaContent(document, "og:description") ||
      getMetaContent(document, "description") ||
      undefined;
    const image = getMetaContent(document, "og:image") || undefined;

    return { title, description, image, url };
  } catch (error) {
    console.error(`Failed to fetch OGP data for ${url}:`, error);
    return null;
  }
}
