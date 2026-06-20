import { createEffect, createMemo, createSignal, Show } from "solid-js";
import type { Post } from "../../types/index.ts";
import { CloseIconLarge } from "./TimelineIcons.tsx";
import { useDialog } from "../../lib/useDialog.ts";
import { useI18n } from "../../lib/i18n.tsx";

// Mirrors the backend limits (posts/transformers.ts). The server stays the
// authority; these only power the counter + a local submit gate.
const MAX_CONTENT_LENGTH = 5000;
const MAX_SUMMARY_LENGTH = 500;

interface EditPostModalProps {
  // The post being edited. The modal is mounted fresh per open (keyed <Show> in
  // the parent), so initialising local signals from these props is safe.
  post: Post;
  saving: boolean;
  onClose: () => void;
  onSave: (data: { content: string; summary: string | null }) => void;
}

// Edit modal for your own post's text + content warning. Only the fields the
// PATCH endpoint accepts (content, summary) are editable here — visibility,
// media and community binding are fixed once a post is published, matching the
// federated Update(Note) the backend emits.
export function EditPostModal(props: EditPostModalProps) {
  const { t } = useI18n();
  let dialogRef: HTMLDivElement | undefined;
  let textareaRef: HTMLTextAreaElement | undefined;
  let cwInputRef: HTMLInputElement | undefined;

  const origContent = props.post.content;
  const origSummary = props.post.summary ?? "";

  const [content, setContent] = createSignal(origContent);
  const [summary, setSummary] = createSignal(origSummary);
  // The CW row starts open when the post already carries a content warning so
  // an existing CW is visible (and removable) on open.
  const [showCw, setShowCw] = createSignal(origSummary.trim().length > 0);

  // The effective CW: empty when the row is collapsed, so toggling CW off and
  // saving clears the warning (the backend reads `summary: ""` as null).
  const effectiveSummary = () => (showCw() ? summary().trim() : "");

  const contentLength = () => content().trim().length;
  const summaryLength = () => summary().trim().length;
  const contentOverLimit = () => contentLength() > MAX_CONTENT_LENGTH;
  const summaryOverLimit = () =>
    showCw() && summaryLength() > MAX_SUMMARY_LENGTH;
  const overLimit = () => contentOverLimit() || summaryOverLimit();

  // Only enable save when something actually changed — an unchanged save would
  // still fan out a no-op Update(Note) to followers.
  const isDirty = () =>
    content().trim() !== origContent.trim() ||
    effectiveSummary() !== origSummary.trim();

  const canSave = createMemo(
    () => contentLength() > 0 && !overLimit() && isDirty() && !props.saving,
  );

  useDialog({
    isOpen: () => true,
    onClose: props.onClose,
    container: () => dialogRef,
    initialFocus: () => textareaRef,
  });

  createEffect(() => {
    if (showCw()) queueMicrotask(() => cwInputRef?.focus());
  });

  const handleSave = () => {
    if (!canSave()) return;
    // Always send `summary` as a string — the edit endpoint only treats a
    // string-typed summary as "provided", so an empty string is what CLEARS a
    // content warning. Sending `null` would be read as "unchanged" and leave a
    // removed CW (and its `sensitive` flag) stuck on the post.
    props.onSave({
      content: content().trim(),
      summary: effectiveSummary(),
    });
  };

  return (
    <div
      class="fixed inset-0 bg-black/70 flex items-start justify-center z-50 p-4 pt-12"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("editPost.title")}
        class="bg-neutral-900 w-full max-w-lg max-h-[calc(100dvh-3rem)] overflow-y-auto rounded-2xl border border-neutral-800"
      >
        {/* Header */}
        <div class="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
          <div class="flex items-center gap-3">
            <button
              onClick={props.onClose}
              aria-label={t("common.close")}
              class="text-white hover:text-neutral-400 transition-colors"
            >
              <CloseIconLarge />
            </button>
            <h2 class="text-base font-bold">{t("editPost.title")}</h2>
          </div>
          <div class="flex items-center gap-3">
            <span
              class={`text-xs tabular-nums ${
                contentOverLimit() ? "text-red-500" : "text-neutral-500"
              }`}
            >
              {t("posts.charCount")
                .replace("{count}", String(contentLength()))
                .replace("{max}", String(MAX_CONTENT_LENGTH))}
            </span>
            <button
              onClick={handleSave}
              disabled={!canSave()}
              class="px-4 py-1.5 bg-accent disabled:bg-neutral-700 disabled:text-neutral-500 rounded-full font-bold text-sm transition-colors"
            >
              {props.saving ? t("common.loading") : t("common.save")}
            </button>
          </div>
        </div>

        {/* Body */}
        <div class="p-4">
          {/* Content warning input */}
          <Show when={showCw()}>
            <div class="mb-3">
              <input
                ref={cwInputRef}
                type="text"
                value={summary()}
                onInput={(e) => setSummary(e.currentTarget.value)}
                placeholder={t("posts.cwPlaceholder")}
                class={`w-full bg-neutral-800 text-white placeholder-neutral-500 rounded-lg px-3 py-2 text-sm outline-none border transition-colors focus:border-accent ${
                  summaryOverLimit() ? "border-red-500" : "border-neutral-700"
                }`}
              />
              <div class="mt-1 flex items-center justify-end gap-2 px-1">
                <Show when={summaryOverLimit()}>
                  <span class="text-xs text-red-500">
                    {t("compose.cwTooLong")}
                  </span>
                </Show>
                <span
                  class={`text-xs tabular-nums ${
                    summaryOverLimit() ? "text-red-500" : "text-neutral-500"
                  }`}
                >
                  {t("posts.charCount")
                    .replace("{count}", String(summaryLength()))
                    .replace("{max}", String(MAX_SUMMARY_LENGTH))}
                </span>
              </div>
            </div>
          </Show>

          <textarea
            ref={textareaRef}
            value={content()}
            onInput={(e) => setContent(e.currentTarget.value)}
            placeholder={t("posts.placeholder")}
            class="w-full bg-transparent text-white placeholder-neutral-500 resize-none outline-none text-lg min-h-[120px]"
          />
        </div>

        {/* Footer — CW toggle only (media/visibility are fixed on edit). */}
        <div class="flex items-center gap-2 px-4 py-3 border-t border-neutral-800">
          <button
            onClick={() => setShowCw((v) => !v)}
            aria-label={t("posts.cwToggle")}
            aria-pressed={showCw()}
            class={`px-2 py-1 rounded-full text-sm font-bold transition-colors ${
              showCw()
                ? "text-accent bg-accent-soft"
                : "text-accent hover:bg-[var(--accent)]/10"
            }`}
          >
            CW
          </button>
        </div>
      </div>
    </div>
  );
}
