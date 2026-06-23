import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Index,
  Show,
} from "solid-js";
import type { Actor } from "../../types/index.ts";
import { UserAvatar } from "../UserAvatar.tsx";
import { CloseIcon, CloseIconLarge, ImageIcon } from "./TimelineIcons.tsx";
import type { UploadedMedia } from "./types.ts";
import type { PostVisibility } from "../../atoms/timeline.ts";
import type { InhabitedScope } from "../../atoms/scope.ts";
import { EmojiPicker } from "../story/EmojiPicker.tsx";
import { ConfirmSheet } from "../ConfirmSheet.tsx";
import { useDialog } from "../../lib/useDialog.ts";
import { useI18n } from "../../lib/i18n.tsx";

// Mirrors the backend MAX_POST_CONTENT_LENGTH (posts/transformers.ts). The
// server stays the authority; this only powers the counter + a local submit
// gate so an over-length post is caught before the round-trip.
const MAX_CONTENT_LENGTH = 5000;

// Mirrors the backend summary (content warning) limit. Like MAX_CONTENT_LENGTH
// this only powers the local counter + submit gate; the server stays the
// authority.
const MAX_SUMMARY_LENGTH = 500;

interface TimelinePostModalProps {
  isOpen: boolean;
  actor: Actor;
  // Posting is always personal (a post goes to your reach). `scope` is only
  // used to render the reach line; callers pass PERSONAL_SCOPE.
  scope: InhabitedScope;
  postContent: string;
  onPostContentChange: (value: string) => void;
  postSummary: string;
  onPostSummaryChange: (value: string) => void;
  postVisibility: PostVisibility;
  onPostVisibilityChange: (value: PostVisibility) => void;
  placeholder: string;
  submitLabel: string;
  submittingLabel: string;
  onClose: () => void;
  onSubmit: () => Promise<boolean>;
  posting: boolean;
  onFileSelect: (
    event: InputEvent & { currentTarget: HTMLInputElement },
  ) => void;
  uploadedMedia: UploadedMedia[];
  onRemoveMedia: (index: number) => void;
  onMediaAltChange: (index: number, alt: string) => void;
  uploading: boolean;
  uploadError: string | null;
}

// Composer visibility options. "direct" is intentionally absent: a DM is not a
// post, so the composer never offers it. The personal-scope audience is the
// only place this select appears; a community scope binds the audience to the
// community (members) and hides the select.
const VISIBILITY_OPTIONS: {
  value: PostVisibility;
  labelKey:
    | "posts.visibilityPublic"
    | "posts.visibilityUnlisted"
    | "posts.visibilityFollowers";
}[] = [
  { value: "public", labelKey: "posts.visibilityPublic" },
  { value: "unlisted", labelKey: "posts.visibilityUnlisted" },
  { value: "followers", labelKey: "posts.visibilityFollowers" },
];

const ChevronDownIcon = () => (
  <svg
    class="h-4 w-4 shrink-0 text-neutral-400"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width={2}
      d="M19 9l-7 7-7-7"
    />
  </svg>
);

export function TimelinePostModal(props: TimelinePostModalProps) {
  const { t } = useI18n();
  const [showCw, setShowCw] = createSignal(false);
  const [showEmoji, setShowEmoji] = createSignal(false);
  // Discard-confirm gate: shown when a dirty composer is closed via Escape /
  // backdrop / the header close button, so an in-progress draft is never lost
  // on a stray tap.
  const [showDiscard, setShowDiscard] = createSignal(false);
  let dialogRef: HTMLDivElement | undefined;
  let textareaRef: HTMLTextAreaElement | undefined;
  let fileInputRef: HTMLInputElement | undefined;
  let cwInputRef: HTMLInputElement | undefined;
  let emojiPanelRef: HTMLDivElement | undefined;

  // The composer holds unsent work worth confirming before discarding.
  const isDirty = () =>
    props.postContent.trim().length > 0 ||
    props.postSummary.trim().length > 0 ||
    props.uploadedMedia.length > 0;

  // Length gate mirrors the server limit; trimmed to match what is actually
  // submitted (createPost trims before sending).
  const contentLength = () => props.postContent.trim().length;
  const summaryLength = () => props.postSummary.trim().length;
  const contentOverLimit = () => contentLength() > MAX_CONTENT_LENGTH;
  const summaryOverLimit = () => summaryLength() > MAX_SUMMARY_LENGTH;
  const overLimit = () => contentOverLimit() || summaryOverLimit();

  const canSubmit = createMemo(
    () =>
      (props.postContent.trim().length > 0 || props.uploadedMedia.length > 0) &&
      !props.posting &&
      !overLimit(),
  );

  // Close request: confirm first when there is unsent content, otherwise close
  // straight away. Used by Escape, the backdrop, and the header close button.
  const requestClose = () => {
    if (props.posting) return;
    if (isDirty()) {
      setShowDiscard(true);
      return;
    }
    props.onClose();
  };

  const confirmDiscard = () => {
    setShowDiscard(false);
    props.onClose();
  };

  // Escape / focus-trap / scroll-lock via the shared dialog primitive. Escape
  // routes through requestClose so a dirty draft triggers the discard confirm.
  useDialog({
    isOpen: () => props.isOpen && !showDiscard(),
    onClose: requestClose,
    container: () => dialogRef,
    // Land focus on the textarea so the composer is type-ready on open, rather
    // than stealing focus to the header close (X) button.
    initialFocus: () => textareaRef,
  });

  // Belt-and-suspenders: focus the textarea on open. useDialog's initialFocus
  // (above) is the canonical path, but this guarantees the composer is
  // type-ready even if focus would otherwise settle on the header close button.
  createEffect(() => {
    if (props.isOpen && !showDiscard()) {
      queueMicrotask(() => textareaRef?.focus());
    }
  });

  // When the CW or emoji panel is toggled open, move focus into the newly
  // shown control so keyboard users land on it without an extra Tab.
  createEffect(() => {
    if (showCw()) queueMicrotask(() => cwInputRef?.focus());
  });
  createEffect(() => {
    if (showEmoji()) {
      queueMicrotask(() => {
        const first =
          emojiPanelRef?.querySelector<HTMLElement>("button, [tabindex]");
        first?.focus();
      });
    }
  });

  // Reach line — reflects the selected visibility so it never under-states a
  // default-public post.
  const reach = () => {
    switch (props.postVisibility) {
      case "unlisted":
        return t("compose.reachUnlisted");
      case "followers":
        return t("compose.reachFollowers");
      case "direct":
        return t("compose.reachDirect");
      default:
        return t("compose.reachPublic");
    }
  };

  // Insert an emoji at the current caret position in the post textarea.
  const insertEmoji = (emoji: string) => {
    const el = textareaRef;
    const current = props.postContent;
    if (!el) {
      props.onPostContentChange(current + emoji);
      return;
    }
    const start = el.selectionStart ?? current.length;
    const end = el.selectionEnd ?? current.length;
    const next = current.slice(0, start) + emoji + current.slice(end);
    props.onPostContentChange(next);
    // Restore caret just after the inserted emoji.
    queueMicrotask(() => {
      el.focus();
      const pos = start + emoji.length;
      el.setSelectionRange(pos, pos);
    });
  };

  return (
    <Show when={props.isOpen}>
      <div
        class="fixed inset-0 bg-black/70 flex items-start justify-center z-50 p-4 pt-12"
        onClick={(e) => {
          if (e.target === e.currentTarget) requestClose();
        }}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={props.placeholder}
          class="bg-neutral-900 w-full max-w-lg max-h-[calc(100dvh-3rem)] overflow-y-auto rounded-2xl border border-neutral-800"
        >
          {/* Modal Header */}
          <div class="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
            <button
              onClick={requestClose}
              aria-label={t("common.close")}
              class="text-white hover:text-neutral-400 transition-colors"
            >
              <CloseIconLarge />
            </button>
            <div class="flex items-center gap-3">
              {/* Character counter; turns red and gates submit when over the
                  server limit. */}
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
                onClick={async () => {
                  const success = await props.onSubmit();
                  if (success) {
                    props.onClose();
                  }
                }}
                disabled={!canSubmit()}
                class="px-4 py-1.5 bg-accent disabled:bg-neutral-700 disabled:text-neutral-500 rounded-full font-bold text-sm transition-colors"
              >
                {props.posting ? props.submittingLabel : props.submitLabel}
              </button>
            </div>
          </div>

          {/* Modal Content */}
          <div class="p-4">
            {/* The post goes to your reach. This control only NARROWS who can
                see it (public / unlisted / followers); a post is not filed into
                a community — that's a separate, deliberate action. */}
            <div class="mb-3 flex flex-wrap items-center gap-2">
              <label class="sr-only" for="post-visibility">
                {t("posts.visibility")}
              </label>
              <select
                id="post-visibility"
                value={props.postVisibility}
                onChange={(e) =>
                  props.onPostVisibilityChange(
                    e.currentTarget.value as PostVisibility,
                  )
                }
                class="bg-neutral-800 text-white text-sm rounded-full px-3 py-1.5 outline-none border border-neutral-700 focus:border-accent transition-colors"
              >
                <For each={VISIBILITY_OPTIONS}>
                  {(opt) => (
                    <option value={opt.value}>{t(opt.labelKey)}</option>
                  )}
                </For>
              </select>
            </div>

            {/* Read-only reach line reflecting the chosen visibility. */}
            <p class="mb-3 px-1 text-xs text-neutral-500">{reach()}</p>

            {/* Content warning input */}
            <Show when={showCw()}>
              <div class="mb-3">
                <input
                  ref={cwInputRef}
                  type="text"
                  value={props.postSummary}
                  onInput={(e) =>
                    props.onPostSummaryChange(e.currentTarget.value)
                  }
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

            <div class="flex gap-3">
              <UserAvatar
                avatarUrl={props.actor.icon_url}
                name={props.actor.name || props.actor.username}
                size={48}
              />
              <div class="flex-1">
                <textarea
                  ref={textareaRef}
                  value={props.postContent}
                  onInput={(e) =>
                    props.onPostContentChange(e.currentTarget.value)
                  }
                  placeholder={props.placeholder}
                  class="w-full bg-transparent text-white placeholder-neutral-500 resize-none outline-none text-lg min-h-[120px]"
                  autofocus
                />
                <Show when={props.uploadedMedia.length > 0}>
                  <div class="flex flex-col gap-3 mt-2">
                    {/* Index (not For): the alt-text inputs are editable and
                        onMediaAltChange rebuilds the array with a NEW object per
                        edited row — <For> keys by reference, so it would recreate
                        the <input> on every keystroke and drop focus. */}
                    <Index each={props.uploadedMedia}>
                      {(media, idx) => (
                        <div class="flex gap-2 items-start">
                          <div class="relative shrink-0">
                            <img
                              src={media().preview}
                              alt={media().name || ""}
                              class="w-20 h-20 object-cover rounded-lg"
                            />
                            <button
                              onClick={() => props.onRemoveMedia(idx)}
                              aria-label={t("compose.removeMedia")}
                              class="absolute -top-1 -right-1 bg-black/70 rounded-full p-0.5 hover:bg-neutral-900"
                            >
                              <CloseIcon />
                            </button>
                          </div>
                          <div class="flex-1">
                            <label class="sr-only" for={`media-alt-${idx}`}>
                              {t("posts.altLabel")}
                            </label>
                            <input
                              id={`media-alt-${idx}`}
                              type="text"
                              value={media().name || ""}
                              onInput={(e) =>
                                props.onMediaAltChange(
                                  idx,
                                  e.currentTarget.value,
                                )
                              }
                              placeholder={t("posts.altPlaceholder")}
                              class="w-full bg-neutral-800 text-white placeholder-neutral-500 rounded-lg px-3 py-2 text-sm outline-none border border-neutral-700 focus:border-accent transition-colors"
                            />
                          </div>
                        </div>
                      )}
                    </Index>
                  </div>
                </Show>
              </div>
            </div>

            {/* Emoji picker */}
            <Show when={showEmoji()}>
              <div
                ref={emojiPanelRef}
                class="mt-3 rounded-xl border border-neutral-800 bg-neutral-900 p-2"
              >
                <EmojiPicker onSelect={insertEmoji} />
              </div>
            </Show>
          </div>

          {/* Modal Footer */}
          <div class="flex items-center gap-2 px-4 py-3 border-t border-neutral-800">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onInput={props.onFileSelect}
              class="hidden"
            />
            <button
              onClick={() => fileInputRef?.click()}
              disabled={props.uploading || props.uploadedMedia.length >= 4}
              aria-label={t("compose.addImage")}
              class="p-2 text-accent hover:bg-[var(--accent)]/10 rounded-full disabled:opacity-50 transition-colors"
            >
              <ImageIcon />
            </button>
            <button
              onClick={() => setShowEmoji((v) => !v)}
              aria-label={t("posts.addEmoji")}
              aria-pressed={showEmoji()}
              class={`p-2 rounded-full transition-colors ${
                showEmoji()
                  ? "text-accent bg-accent-soft"
                  : "text-accent hover:bg-[var(--accent)]/10"
              }`}
            >
              <span class="text-lg leading-none">{"\u{1F642}"}</span>
            </button>
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
            <Show when={props.uploading}>
              <span class="text-sm text-neutral-500">
                {t("common.uploading")}
              </span>
            </Show>
            <Show when={props.uploadError}>
              <span role="alert" class="text-sm text-red-500">
                {props.uploadError}
              </span>
            </Show>
          </div>
        </div>
      </div>
      {/* Discard confirm — layered above the composer; cancel keeps editing. */}
      <ConfirmSheet
        open={showDiscard()}
        title={t("posts.discardTitle")}
        body={t("posts.discardBody")}
        confirmLabel={t("posts.discardConfirm")}
        cancelLabel={t("posts.keepEditing")}
        destructive
        onConfirm={confirmDiscard}
        onCancel={() => setShowDiscard(false)}
      />
    </Show>
  );
}
