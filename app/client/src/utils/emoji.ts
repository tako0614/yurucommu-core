export const emojiMap: Record<string, string> = {
  ":smile:": "😄",
  ":laughing:": "😆",
  ":blush:": "😊",
  ":smiley:": "😃",
  ":heart:": "❤️",
  ":thumbsup:": "👍",
  ":thumbsdown:": "👎",
  ":sob:": "😭",
  ":thinking:": "🤔",
  ":sunglasses:": "😎",
  ":flushed:": "😳",
  ":fire:": "🔥",
  ":tada:": "🎉",
  ":rocket:": "🚀",
  ":rss:": "📡",
};

const shortcodeRegex = /:[a-z0-9_+\-]+:/gi;

export function replaceShortcodes(text: string): string {
  return text.replace(shortcodeRegex, (match) => {
    const key = match.toLowerCase();
    return emojiMap[key] ?? match;
  });
}
