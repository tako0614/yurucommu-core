import { createSignal, Show } from "solid-js";
import { CloseIcon } from "./ProfileIcons.tsx";
import { UserAvatar } from "../UserAvatar.tsx";
import { uploadMedia } from "../../lib/api/media.ts";
import { useDialog } from "../../lib/useDialog.ts";
import type { Translate } from "../../lib/i18n.tsx";

interface ProfileEditModalProps {
  isOpen: boolean;
  editName: string;
  editSummary: string;
  editIsPrivate: boolean;
  editIconUrl?: string;
  editHeaderUrl?: string;
  saving: boolean;
  onClose: () => void;
  onSave: () => void;
  onChangeName: (
    event: InputEvent & { currentTarget: HTMLInputElement },
  ) => void;
  onChangeSummary: (
    event: InputEvent & { currentTarget: HTMLTextAreaElement },
  ) => void;
  onTogglePrivate: () => void;
  onChangeIconUrl: (url: string) => void;
  onChangeHeaderUrl: (url: string) => void;
  t: Translate;
}

export function ProfileEditModal(props: ProfileEditModalProps) {
  let dialogRef: HTMLDivElement | undefined;
  const [uploadingIcon, setUploadingIcon] = createSignal(false);
  const [uploadingHeader, setUploadingHeader] = createSignal(false);

  useDialog({
    isOpen: () => props.isOpen,
    onClose: props.onClose,
    container: () => dialogRef,
  });

  const handleUpload = async (
    file: File | undefined,
    setBusy: (busy: boolean) => void,
    apply: (url: string) => void,
  ) => {
    if (!file) return;
    setBusy(true);
    try {
      const result = await uploadMedia(file);
      apply(result.url);
    } catch (err) {
      console.error("Failed to upload image:", err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Show when={props.isOpen}>
      <div
        class="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
        onClick={(e) => {
          if (e.target === e.currentTarget) props.onClose();
        }}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="profile-edit-title"
          class="bg-neutral-900 rounded-2xl w-full max-w-md max-h-[calc(100dvh-3rem)] overflow-y-auto"
        >
          <div class="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
            <div class="flex items-center gap-4">
              <button
                onClick={props.onClose}
                aria-label={props.t("common.close")}
                class="p-1 hover:bg-neutral-800 rounded-full transition-colors"
              >
                <CloseIcon />
              </button>
              <h2 id="profile-edit-title" class="text-lg font-bold">
                {props.t("profile.editProfile")}
              </h2>
            </div>
            <button
              onClick={props.onSave}
              disabled={props.saving || uploadingIcon() || uploadingHeader()}
              class="px-4 py-1.5 bg-white text-black rounded-full font-bold text-sm hover:bg-neutral-200 disabled:bg-neutral-600 transition-colors"
            >
              {props.saving
                ? props.t("common.loading")
                : props.t("common.save")}
            </button>
          </div>
          <div class="p-4 space-y-4">
            {/* Header image */}
            <div>
              <label class="block text-sm text-neutral-400 mb-1">
                {props.t("profile.changeHeader")}
              </label>
              <label class="relative block h-28 w-full cursor-pointer overflow-hidden rounded-lg bg-neutral-800">
                <Show when={props.editHeaderUrl}>
                  <img
                    src={props.editHeaderUrl}
                    alt=""
                    class="h-full w-full object-cover"
                  />
                </Show>
                <div class="absolute inset-0 flex items-center justify-center bg-black/30 text-sm text-white">
                  {uploadingHeader()
                    ? props.t("common.loading")
                    : props.t("profile.changeHeader")}
                </div>
                <input
                  type="file"
                  accept="image/*"
                  class="hidden"
                  disabled={uploadingHeader()}
                  onChange={(e) => {
                    void handleUpload(
                      e.currentTarget.files?.[0],
                      setUploadingHeader,
                      props.onChangeHeaderUrl,
                    );
                    e.currentTarget.value = "";
                  }}
                />
              </label>
            </div>

            {/* Avatar */}
            <div>
              <label class="block text-sm text-neutral-400 mb-1">
                {props.t("profile.changeAvatar")}
              </label>
              <label class="relative inline-flex h-20 w-20 cursor-pointer items-center justify-center overflow-hidden rounded-full bg-neutral-800">
                <UserAvatar
                  avatarUrl={props.editIconUrl ?? null}
                  name={props.editName || "?"}
                  size={80}
                />
                <div class="absolute inset-0 flex items-center justify-center bg-black/40 text-center text-[11px] leading-tight text-white">
                  {uploadingIcon()
                    ? props.t("common.loading")
                    : props.t("profile.changeAvatar")}
                </div>
                <input
                  type="file"
                  accept="image/*"
                  class="hidden"
                  disabled={uploadingIcon()}
                  onChange={(e) => {
                    void handleUpload(
                      e.currentTarget.files?.[0],
                      setUploadingIcon,
                      props.onChangeIconUrl,
                    );
                    e.currentTarget.value = "";
                  }}
                />
              </label>
            </div>

            <div>
              <label
                for="profile-edit-name"
                class="block text-sm text-neutral-400 mb-1"
              >
                {props.t("profile.editNameLabel")}
              </label>
              <input
                id="profile-edit-name"
                type="text"
                value={props.editName}
                onInput={props.onChangeName}
                placeholder={props.t("profile.editNamePlaceholder")}
                class="w-full bg-neutral-800 rounded-lg px-3 py-2 text-white placeholder-neutral-500 outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label
                for="profile-edit-bio"
                class="block text-sm text-neutral-400 mb-1"
              >
                {props.t("profile.editBioLabel")}
              </label>
              <textarea
                id="profile-edit-bio"
                value={props.editSummary}
                onInput={props.onChangeSummary}
                placeholder={props.t("profile.editBioPlaceholder")}
                rows={4}
                class="w-full bg-neutral-800 rounded-lg px-3 py-2 text-white placeholder-neutral-500 outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>
            <div class="flex items-center justify-between py-2">
              <div>
                <div class="text-white font-medium">
                  {props.t("profile.followApproval")}
                </div>
                <div class="text-sm text-neutral-400">
                  {props.t("profile.followApprovalDesc")}
                </div>
              </div>
              <button
                type="button"
                onClick={props.onTogglePrivate}
                class={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  props.editIsPrivate ? "bg-blue-500" : "bg-neutral-600"
                }`}
              >
                <span
                  class={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    props.editIsPrivate ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}
