export const emojiMap: Record<string, string> = {
  ":smile:": "í¸„",
  ":laughing:": "í¸†",
  ":blush:": "í¸Š",
  ":smiley:": "í¸ƒ",
  ":heart:": "â¤ï¸",
  ":thumbsup:": "ï¿½ï¿½",
  ":thumbsdown:": "í±Ž",
  ":sob:": "í¸­",
  ":thinking:": "í´”",
  ":sunglasses:": "í¸Ž",
  ":flushed:": "í¸³",
  ":fire:": "í´¥",
  ":tada:": "í¾‰",
  ":rocket:": "íº€",
};

const shortcodeRegex = /:[a-z0-9_+\-]+:/gi;

export function replaceShortcodes(text: string): string {
  return text.replace(shortcodeRegex, (match) => {
    const key = match.toLowerCase();
    return emojiMap[key] ?? match;
  });
}
