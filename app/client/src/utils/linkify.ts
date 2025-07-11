// マイクロブログの投稿テキスト中のURLを安全なリンクへ変換するユーティリティ

const URL_RE =
  /(^|[\s\u3000(<{\[「『【〈《（])(?:https?:\/\/[^\s<>{}\[\]「」『』【】〈〉《》()]+?)(?=[\s\u3000)>}\]」』】〉》）.,!?。、・…]|$)/giu;

function sanitizeUrl(raw: string): string {
  let url = raw.replace(/[\u200B-\u200D\uFEFF]/g, "");

  while (true) {
    const last = url.slice(-1);
    if (/[\)\]\}>」』】〉》）]/u.test(last)) {
      url = url.slice(0, -1);
      continue;
    }
    if (/[.,!?。、・…]/u.test(last) && url.slice(-2, -1) !== "/") {
      url = url.slice(0, -1);
      continue;
    }
    break;
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "";
    }
    // hostname を参照するだけで Punycode へ変換される
    const _ = parsed.hostname;
    return parsed.toString();
  } catch {
    return "";
  }
}

export function linkify(text: string): string {
  if (text.length > 2 * 1024 * 1024) return text;

  const re = new RegExp(URL_RE.source, "giu");
  const matches = [...text.matchAll(re)];
  if (matches.length > 10) return text;

  return text.replace(re, (match, p1, url) => {
    const safe = sanitizeUrl(url);
    if (!safe) return match;
    return `${p1}<a href="${safe}" rel="noopener noreferrer" target="_blank">${url}</a>`;
  });
}
