import { Show, createEffect, createSignal } from "solid-js";
import type { Community } from "../lib/api-client";
import { ApiError } from "../lib/api-client";
import { createCommunity } from "../lib/api";

type CommunityCreateModalProps = {
  open: boolean;
  onClose: () => void;
  onCreated?: (community: Community) => void;
};

export default function CommunityCreateModal(props: CommunityCreateModalProps) {
  const [name, setName] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [submitting, setSubmitting] = createSignal(false);
  let inputRef: HTMLInputElement | undefined;

  createEffect(() => {
    if (props.open) {
      setName("");
      setError(null);
      setSubmitting(false);
      const focusInput = () => inputRef?.focus();
      if (typeof queueMicrotask === "function") {
        queueMicrotask(focusInput);
      } else {
        setTimeout(focusInput, 0);
      }
    }
  });

  const handleClose = () => {
    if (submitting()) return;
    props.onClose();
  };

  const handleSubmit = async (event?: Event) => {
    event?.preventDefault();
    if (submitting()) return;
    const trimmed = name().trim();
    if (!trimmed) {
      setError("コミュニティ名を入力してください");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const community = await createCommunity(trimmed);
      props.onCreated?.(community);
    } catch (err) {
      if (err instanceof ApiError && err.message) {
        setError(err.message);
      } else {
        setError("コミュニティを作成できませんでした");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Show when={props.open}>
      <div class="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
        <button
          type="button"
          class="absolute inset-0 bg-black/30"
          aria-label="閉じる"
          onClick={handleClose}
        />
        <div class="relative z-10 w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
          <div class="space-y-1">
            <h2 class="text-xl font-semibold">コミュニティを作成</h2>
            <p class="text-sm text-gray-500">新しいコミュニティの名前を入力してください。</p>
          </div>
          <form class="mt-6 space-y-4" onSubmit={(event) => void handleSubmit(event)}>
            <div class="space-y-2">
              <label for="community-name" class="text-sm font-medium text-gray-700">
                コミュニティ名
              </label>
              <input
                id="community-name"
                type="text"
                class="w-full rounded-2xl border px-4 py-3 text-base outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="例: カフェ好きの集い"
                value={name()}
                onInput={(event) => {
                  setName((event.target as HTMLInputElement).value);
                  if (error()) setError(null);
                }}
                disabled={submitting()}
                maxLength={60}
                ref={(element) => {
                  inputRef = element;
                }}
              />
            </div>
            <Show when={error()}>
              {(message) => <p class="text-sm text-red-600">{message()}</p>}
            </Show>
            <div class="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                class="rounded-full border px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                onClick={handleClose}
                disabled={submitting()}
              >
                キャンセル
              </button>
              <button
                type="submit"
                class="inline-flex items-center gap-2 rounded-full bg-blue-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
                disabled={submitting()}
              >
                {submitting() ? (
                  <>
                    <span class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    作成中...
                  </>
                ) : (
                  "作成"
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Show>
  );
}
