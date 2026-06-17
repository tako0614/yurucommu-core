import { A } from "@solidjs/router";
import { createMemo, createSignal, For, Show } from "solid-js";
import { useI18n } from "../lib/i18n.tsx";
import { looksLikeHtml, sanitizeHtml } from "../lib/sanitize-html.ts";

interface PostContentProps {
  content: string;
  // Optional content warning / summary. When present, the body is collapsed
  // behind a reveal toggle.
  summary?: string | null;
  class?: string;
  // Optional controlled reveal state. When provided, the CW reveal toggle is
  // driven by the parent so a single reveal can also un-hide an accompanying
  // media hero (see TimelinePostItem). When omitted, PostContent owns its own
  // local reveal state.
  revealed?: boolean;
  onToggleReveal?: () => void;
}

type ContentPart =
  | { type: "text"; text: string; position: number }
  | { type: "mention"; username: string; position: number };

// Linkify bare @mentions in the text regions of an already-sanitized HTML
// string, without touching anything inside `<...>` tags (so existing href
// attributes and anchor text are left intact). The mention link itself is
// emitted as a safe http-relative anchor with the same rel/target policy the
// sanitizer enforces.
function linkifyMentionsInHtml(html: string): string {
  const mentionRe = /@([a-zA-Z0-9_]+)/g;
  let out = "";
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    const segmentEnd = lt === -1 ? html.length : lt;
    const text = html.slice(i, segmentEnd);
    out += text.replace(mentionRe, (_m, username: string) => {
      const href = `/groups?search=@${encodeURIComponent(username)}`;
      return (
        `<a href="${href}" rel="noopener noreferrer nofollow"` +
        ` data-mention="${username}">@${username}</a>`
      );
    });
    if (lt === -1) break;
    const gt = html.indexOf(">", lt + 1);
    const tagEnd = gt === -1 ? html.length : gt + 1;
    out += html.slice(lt, tagEnd);
    i = tagEnd;
  }
  return out;
}

// Parse post content and render mentions as clickable links
export function PostContent(props: PostContentProps) {
  const { t } = useI18n();
  const [localRevealed, setLocalRevealed] = createSignal(false);
  // Use the controlled reveal state when the parent supplies one, otherwise
  // fall back to the local signal.
  const revealed = () =>
    props.onToggleReveal ? !!props.revealed : localRevealed();
  const toggleReveal = () => {
    if (props.onToggleReveal) {
      props.onToggleReveal();
    } else {
      setLocalRevealed((v) => !v);
    }
  };
  const hasSummary = createMemo(() => !!props.summary && props.summary.trim());

  // Remote ActivityPub posts arrive as HTML; local posts are plain text.
  const isHtml = createMemo(() => looksLikeHtml(props.content));

  // SECURITY: this string is assigned to innerHTML below. It is the output of
  // the strict allowlist sanitizer (only safe formatting tags + http(s) links
  // survive), then mentions are linkified only in text regions.
  const sanitizedHtml = createMemo(() =>
    linkifyMentionsInHtml(sanitizeHtml(props.content)),
  );

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

  const plainBody = (
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
              class="text-accent hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              @{part.username}
            </A>
          );
        }}
      </For>
    </p>
  );

  // Sanitized remote HTML. The container links inherit blue styling; the
  // innerHTML payload is XSS-safe (see sanitizedHtml above).
  const htmlBody = (
    <div
      class={`post-html break-words [&_a]:text-blue-400 [&_a:hover]:underline ${
        props.class ?? ""
      }`}
      onClick={(e) => {
        // Keep link clicks from also triggering the surrounding post link.
        if ((e.target as HTMLElement)?.closest("a")) e.stopPropagation();
      }}
      // eslint-disable-next-line solid/no-innerhtml
      innerHTML={sanitizedHtml()}
    />
  );

  const body = isHtml() ? htmlBody : plainBody;

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
            toggleReveal();
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
