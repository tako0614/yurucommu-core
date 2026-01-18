import { Link } from 'react-router-dom';
import { useMemo } from 'react';

interface PostContentProps {
  content: string;
  className?: string;
}

// Parse post content and render mentions as clickable links
export function PostContent({ content, className = '' }: PostContentProps) {
  const parsedContent = useMemo(() => {
    // Regex to match @username (alphanumeric and underscores)
    const mentionRegex = /@([a-zA-Z0-9_]+)/g;
    const parts: ({ type: 'text'; text: string; position: number } | { type: 'mention'; username: string; position: number })[] = [];
    let lastIndex = 0;
    let match;

    while ((match = mentionRegex.exec(content)) !== null) {
      // Add text before the mention
      if (match.index > lastIndex) {
        parts.push({ type: 'text', text: content.slice(lastIndex, match.index), position: lastIndex });
      }
      // Add the mention
      parts.push({ type: 'mention', username: match[1], position: match.index });
      lastIndex = match.index + match[0].length;
    }

    // Add remaining text
    if (lastIndex < content.length) {
      parts.push({ type: 'text', text: content.slice(lastIndex), position: lastIndex });
    }

    return parts;
  }, [content]);

  return (
    <p className={`whitespace-pre-wrap break-words ${className}`}>
      {parsedContent.map((part) => {
        if (part.type === 'text') {
          return <span key={`text-${part.position}`}>{part.text}</span>;
        }
        // Render mention as a link to Groups search
        return (
          <Link
            key={`mention-${part.position}`}
            to={`/groups?search=@${part.username}`}
            className="text-blue-400 hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            @{part.username}
          </Link>
        );
      })}
    </p>
  );
}
