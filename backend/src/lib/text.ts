const HASHTAG_REGEX = /(^|[^\p{L}\p{N}_])#([\p{L}\p{N}_][\p{L}\p{N}_-]*)/gu;
const MENTION_REGEX = /(^|[^/\w])@([A-Za-z0-9_][A-Za-z0-9_.-]*)/g;

export function extractHashtags(text: string): string[] {
  if (!text) return [];
  const tags = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = HASHTAG_REGEX.exec(text)) !== null) {
    const tag = match[2]?.trim();
    if (tag) {
      tags.add(tag.toLowerCase());
    }
  }
  return Array.from(tags);
}

export function extractMentions(text: string): string[] {
  if (!text) return [];
  const handles = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = MENTION_REGEX.exec(text)) !== null) {
    const handle = match[2]?.trim();
    if (handle) {
      handles.add(handle.toLowerCase());
    }
  }
  return Array.from(handles);
}

export function normalizeHashtag(tag: string): string {
  return (tag || "").replace(/^#/, "").trim().toLowerCase();
}
