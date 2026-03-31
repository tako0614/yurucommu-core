import { A } from '@solidjs/router';
import { createMemo, For } from 'solid-js';

interface PostContentProps {
  content: string;
  class?: string;
}

type ContentPart =
  | { type: 'text'; text: string; position: number }
  | { type: 'mention'; username: string; position: number };

// Parse post content and render mentions as clickable links
export function PostContent(props: PostContentProps) {
  const parsedContent = createMemo(() => {
    // Regex to match @username (alphanumeric and underscores)
    const mentionRegex = /@([a-zA-Z0-9_]+)/g;
    const parts: ContentPart[] = [];
    let lastIndex = 0;
    let match;

    while ((match = mentionRegex.exec(props.content)) !== null) {
      // Add text before the mention
      if (match.index > lastIndex) {
        parts.push({ type: 'text', text: props.content.slice(lastIndex, match.index), position: lastIndex });
      }
      // Add the mention
      parts.push({ type: 'mention', username: match[1], position: match.index });
      lastIndex = match.index + match[0].length;
    }

    // Add remaining text
    if (lastIndex < props.content.length) {
      parts.push({ type: 'text', text: props.content.slice(lastIndex), position: lastIndex });
    }

    return parts;
  });

  return (
    <p class={`whitespace-pre-wrap break-words ${props.class ?? ''}`}>
      <For each={parsedContent()}>{(part) => {
        if (part.type === 'text') {
          return <span>{part.text}</span>;
        }
        // Render mention as a link to Groups search
        return (
          <A
            href={`/groups?search=@${part.username}`}
            class="text-blue-400 hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            @{part.username}
          </A>
        );
      }}</For>
    </p>
  );
}
