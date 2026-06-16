import { For, Show } from "solid-js";
import type { Actor } from "../../types/index.ts";
import { UserAvatar } from "../UserAvatar.tsx";
import { CloseIcon, CloseIconLarge, ImageIcon } from "./TimelineIcons.tsx";
import type { UploadedMedia } from "./types.ts";
import { useI18n } from "../../lib/i18n.tsx";

interface TimelinePostModalProps {
  isOpen: boolean;
  actor: Actor;
  postContent: string;
  onPostContentChange: (value: string) => void;
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
  uploading: boolean;
  uploadError: string | null;
}

export function TimelinePostModal(props: TimelinePostModalProps) {
  const { t } = useI18n();
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
            <div class="flex gap-3">
              <UserAvatar
                avatarUrl={props.actor.icon_url}
                name={props.actor.name || props.actor.username}
                size={48}
              />
              <div class="flex-1">
                <textarea
                  value={props.postContent}
                  onInput={(e) =>
                    props.onPostContentChange(e.currentTarget.value)
                  }
                  placeholder={props.placeholder}
                  class="w-full bg-transparent text-white placeholder-neutral-500 resize-none outline-none text-lg min-h-[120px]"
                  autofocus
                />
                <Show when={props.uploadedMedia.length > 0}>
                  <div class="flex flex-wrap gap-2 mt-2">
                    <For each={props.uploadedMedia}>
                      {(media, idx) => (
                        <div class="relative">
                          <img
                            src={media.preview}
                            alt=""
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
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            </div>
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
