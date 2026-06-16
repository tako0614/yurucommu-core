import { A } from "@solidjs/router";
import { createMemo, createSignal, For, Show } from "solid-js";
import { useI18n } from "../lib/i18n.tsx";

interface PostContentProps {
  content: string;
  // Optional content warning / summary. When present, the body is collapsed
  // behind a reveal toggle.
  summary?: string | null;
  class?: string;
}

type ContentPart =
  | { type: "text"; text: string; position: number }
  | { type: "mention"; username: string; position: number };

// Parse post content and render mentions as clickable links
export function PostContent(props: PostContentProps) {
  const { t } = useI18n();
  const [revealed, setRevealed] = createSignal(false);
  const hasSummary = createMemo(() => !!props.summary && props.summary.trim());

  const parsedContent = createMemo(() => {
    // Regex to match @username (alphanumeric and underscores)
    const mentionRegex = /@([a-zA-Z0-9_]+)/g;
    const parts: ContentPart[] = [];
    let lastIndex = 0;
    let match;

    while ((match = mentionRegex.exec(props.content)) !== null) {
      // Add text before the mention
      if (match.index > lastIndex) {
        parts.push({
          type: "text",
          text: props.content.slice(lastIndex, match.index),
          position: lastIndex,
        });
      }
      // Add the mention
      parts.push({
        type: "mention",
        username: match[1],
        position: match.index,
      });
      lastIndex = match.index + match[0].length;
    }

    // Add remaining text
    if (lastIndex < props.content.length) {
      parts.push({
        type: "text",
        text: props.content.slice(lastIndex),
        position: lastIndex,
      });
    }

    return parts;
  });

  const body = (
    <p class={`whitespace-pre-wrap break-words ${props.class ?? ""}`}>
      <For each={parsedContent()}>
        {(part) => {
          if (part.type === "text") {
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
        }}
      </For>
    </p>
  );

  return (
    <Show when={hasSummary()} fallback={body}>
      <div class={props.class ?? ""}>
        <p class="whitespace-pre-wrap break-words text-neutral-200">
          {props.summary}
        </p>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setRevealed((v) => !v);
          }}
          class="mt-1 px-3 py-1 rounded-full bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-sm font-bold transition-colors"
        >
          {revealed() ? t("posts.showLess") : t("posts.showMore")}
        </button>
        <Show when={revealed()}>
          <div class="mt-2">{body}</div>
        </Show>
      </div>
    </Show>
  );
}
