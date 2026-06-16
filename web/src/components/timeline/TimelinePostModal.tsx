import { createSignal, For, Show } from "solid-js";
import type { Actor } from "../../types/index.ts";
import { UserAvatar } from "../UserAvatar.tsx";
import { CloseIcon, CloseIconLarge, ImageIcon } from "./TimelineIcons.tsx";
import type { UploadedMedia } from "./types.ts";
import type { PostVisibility } from "../../atoms/timeline.ts";
import { EmojiPicker } from "../story/EmojiPicker.tsx";
import { useI18n } from "../../lib/i18n.tsx";

interface TimelinePostModalProps {
  isOpen: boolean;
  actor: Actor;
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
  fileInputRef: HTMLInputElement | undefined;
  onFileSelect: (
    event: InputEvent & { currentTarget: HTMLInputElement },
  ) => void;
  uploadedMedia: UploadedMedia[];
  onRemoveMedia: (index: number) => void;
  onMediaAltChange: (index: number, alt: string) => void;
  uploading: boolean;
  uploadError: string | null;
}

const VISIBILITY_OPTIONS: {
  value: PostVisibility;
  labelKey:
    | "posts.visibilityPublic"
    | "posts.visibilityUnlisted"
    | "posts.visibilityFollowers"
    | "posts.visibilityDirect";
}[] = [
  { value: "public", labelKey: "posts.visibilityPublic" },
  { value: "unlisted", labelKey: "posts.visibilityUnlisted" },
  { value: "followers", labelKey: "posts.visibilityFollowers" },
  { value: "direct", labelKey: "posts.visibilityDirect" },
];

export function TimelinePostModal(props: TimelinePostModalProps) {
  const { t } = useI18n();
  const [showCw, setShowCw] = createSignal(false);
  const [showEmoji, setShowEmoji] = createSignal(false);
  let textareaRef: HTMLTextAreaElement | undefined;

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
      <div class="fixed inset-0 bg-black/70 flex items-start justify-center z-50 p-4 pt-12">
        <div class="bg-neutral-900 w-full max-w-lg rounded-2xl border border-neutral-800">
          {/* Modal Header */}
          <div class="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
            <button
              onClick={props.onClose}
              aria-label="Close"
              class="text-white hover:text-neutral-400 transition-colors"
            >
              <CloseIconLarge />
            </button>
            <button
              onClick={async () => {
                const success = await props.onSubmit();
                if (success) {
                  props.onClose();
                }
              }}
              disabled={
                (!props.postContent.trim() &&
                  props.uploadedMedia.length === 0) ||
                props.posting
              }
              class="px-4 py-1.5 bg-blue-500 hover:bg-blue-600 disabled:bg-neutral-700 disabled:text-neutral-500 rounded-full font-bold text-sm transition-colors"
            >
              {props.posting ? props.submittingLabel : props.submitLabel}
            </button>
          </div>

          {/* Modal Content */}
          <div class="p-4">
            {/* Visibility selector */}
            <div class="mb-3">
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
                class="bg-neutral-800 text-white text-sm rounded-full px-3 py-1.5 outline-none border border-neutral-700 focus:border-blue-500 transition-colors"
              >
                <For each={VISIBILITY_OPTIONS}>
                  {(opt) => (
                    <option value={opt.value}>{t(opt.labelKey)}</option>
                  )}
                </For>
              </select>
            </div>

            {/* Content warning input */}
            <Show when={showCw()}>
              <input
                type="text"
                value={props.postSummary}
                onInput={(e) =>
                  props.onPostSummaryChange(e.currentTarget.value)
                }
                placeholder={t("posts.cwPlaceholder")}
                class="w-full bg-neutral-800 text-white placeholder-neutral-500 rounded-lg px-3 py-2 mb-3 text-sm outline-none border border-neutral-700 focus:border-blue-500 transition-colors"
              />
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
                    <For each={props.uploadedMedia}>
                      {(media, idx) => (
                        <div class="flex gap-2 items-start">
                          <div class="relative shrink-0">
                            <img
                              src={media.preview}
                              alt={media.name || ""}
                              class="w-20 h-20 object-cover rounded-lg"
                            />
                            <button
                              onClick={() => props.onRemoveMedia(idx())}
                              aria-label="Remove media"
                              class="absolute -top-1 -right-1 bg-black/70 rounded-full p-0.5 hover:bg-neutral-900"
                            >
                              <CloseIcon />
                            </button>
                          </div>
                          <div class="flex-1">
                            <label class="sr-only" for={`media-alt-${idx()}`}>
                              {t("posts.altLabel")}
                            </label>
                            <input
                              id={`media-alt-${idx()}`}
                              type="text"
                              value={media.name || ""}
                              onInput={(e) =>
                                props.onMediaAltChange(
                                  idx(),
                                  e.currentTarget.value,
                                )
                              }
                              placeholder={t("posts.altPlaceholder")}
                              class="w-full bg-neutral-800 text-white placeholder-neutral-500 rounded-lg px-3 py-2 text-sm outline-none border border-neutral-700 focus:border-blue-500 transition-colors"
                            />
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            </div>

            {/* Emoji picker */}
            <Show when={showEmoji()}>
              <div class="mt-3 rounded-xl border border-neutral-800 bg-neutral-900 p-2">
                <EmojiPicker onSelect={insertEmoji} />
              </div>
            </Show>
          </div>

          {/* Modal Footer */}
          <div class="flex items-center gap-2 px-4 py-3 border-t border-neutral-800">
            <input
              ref={props.fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onInput={props.onFileSelect}
              class="hidden"
            />
            <button
              onClick={() => props.fileInputRef?.click()}
              disabled={props.uploading || props.uploadedMedia.length >= 4}
              aria-label="Add image"
              class="p-2 text-blue-500 hover:bg-blue-500/10 rounded-full disabled:opacity-50 transition-colors"
            >
              <ImageIcon />
            </button>
            <button
              onClick={() => setShowEmoji((v) => !v)}
              aria-label={t("posts.addEmoji")}
              aria-pressed={showEmoji()}
              class={`p-2 rounded-full transition-colors ${
                showEmoji()
                  ? "text-blue-500 bg-blue-500/10"
                  : "text-blue-500 hover:bg-blue-500/10"
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
                  ? "text-blue-500 bg-blue-500/10"
                  : "text-blue-500 hover:bg-blue-500/10"
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
              <span class="text-sm text-red-500">{props.uploadError}</span>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
}
