import { A } from "@solidjs/router";
import { createMemo, createSignal, For, Show } from "solid-js";
import { useI18n } from "../lib/i18n.tsx";
import { looksLikeHtml, sanitizeHtml } from "../lib/sanitize-html.ts";
import {
  makeTokenRe,
  parsePostTokens,
  tokenSearchHref,
} from "../lib/post-tokens.ts";

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

// Linkify bare @mentions and #hashtags in the text regions of an
// already-sanitized HTML string, without touching anything inside `<...>` tags
// (so existing href attributes and anchor text are left intact). Links are
// emitted with the same rel policy the sanitizer enforces.
function linkifyTokensInHtml(html: string): string {
  let out = "";
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    const segmentEnd = lt === -1 ? html.length : lt;
    const text = html.slice(i, segmentEnd);
    out += text.replace(makeTokenRe(), (full, mention, hashtag) => {
      const query = mention !== undefined ? `@${mention}` : `#${hashtag}`;
      const href = tokenSearchHref(query);
      const attr =
        mention !== undefined
          ? `data-mention="${mention}"`
          : `data-hashtag="${hashtag}"`;
      return (
        `<a href="${href}" rel="noopener noreferrer nofollow" ${attr}>` +
        `${full}</a>`
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
    linkifyTokensInHtml(sanitizeHtml(props.content)),
  );

  const parsedContent = createMemo(() => parsePostTokens(props.content));

  const plainBody = (
    <p class={`whitespace-pre-wrap break-words ${props.class ?? ""}`}>
      <For each={parsedContent()}>
        {(part) => {
          if (part.type === "text") {
            return <span>{part.text}</span>;
          }
          // Mentions and hashtags both link to the instance search.
          const prefix = part.type === "mention" ? "@" : "#";
          return (
            <A
              href={tokenSearchHref(`${prefix}${part.value}`)}
              // Persistent underline (not hover-only): an inline link inside a
              // text block must be distinguishable by more than color (WCAG
              // 1.4.1). underline-offset keeps it readable against the text.
              class="text-accent underline underline-offset-2"
              onClick={(e) => e.stopPropagation()}
            >
              {prefix}
              {part.value}
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
