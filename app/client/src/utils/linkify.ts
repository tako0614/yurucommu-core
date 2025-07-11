
const URL_PREFIX = /(^|\s|\u3000|[\(\[\{「『【〈《（])(https?:\/\/[^\s<>{}\[\]「」『』【】〈〉《》()]+)/giu;

export function linkify(text: string): string {
  return text.replace(URL_PREFIX, (match, p1, url) => {
    let cleanUrl = url;
    // 末尾の句読点や閉じ括弧を削除
    while (/[.,!?。、・…\)\]\}」』】〉》）]$/u.test(cleanUrl)) {
      // ただし、URLの末尾がスラッシュで終わる場合は、その直前の句読点は削除しない
      if (cleanUrl.endsWith('/') && /[.,!?。、・…]$/.test(cleanUrl.slice(0, -1))) {
          break;
      }
      cleanUrl = cleanUrl.slice(0, -1);
    }
    
    try {
      // URLが有効かどうかの最終検証
      new URL(cleanUrl);
      return `${p1}<a href="${cleanUrl}" rel="noopener noreferrer" target="_blank">${cleanUrl}</a>`;
    } catch (e) {
      // 無効なURLの場合は、元のテキストをそのまま返す
      return match;
    }
  });
}
