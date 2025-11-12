import { createEffect, createSignal, Show } from "solid-js";
import { updateMe, uploadMedia, useMe } from "../lib/api";

const HANDLE_PATTERN = /^[a-z0-9_]{3,20}$/;

export default function EditProfile() {
  const me = useMe();
  const [displayName, setDisplayName] = createSignal("");
  const [avatarUrl, setAvatarUrl] = createSignal("");
  const [handle, setHandle] = createSignal("");
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [uploading, setUploading] = createSignal(false);

  createEffect(() => {
    const u = me();
    if (u) {
      setDisplayName(u.display_name || "");
      setAvatarUrl(u.avatar_url || "");
      setHandle((u as any).handle || "");
    }
  });

  const onSubmit = async (e: Event) => {
    e.preventDefault();
    const normalizedHandle = handle().trim().toLowerCase();
    if (!HANDLE_PATTERN.test(normalizedHandle)) {
      setError("IDは半角英数字とアンダースコアで3〜20文字にしてください");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateMe({
        handle: normalizedHandle,
        display_name: displayName(),
        avatar_url: avatarUrl(),
      });
      location.href = "/profile";
    } catch (err: any) {
      if (typeof err?.message === "string") {
        if (err.message.includes("handle already taken")) {
          setError("このIDは既に使われています");
        } else if (err.message.includes("invalid handle")) {
          setError("IDは半角英数字とアンダースコアで3〜20文字にしてください");
        } else {
          setError(err.message);
        }
      } else {
        setError("更新に失敗しました");
      }
    } finally {
      setSaving(false);
    }
  };

  const onPickAvatar = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const url = await uploadMedia(file);
      setAvatarUrl(url);
    } catch (err: any) {
      setError(err?.message || "画像のアップロードに失敗しました");
    } finally {
      setUploading(false);
      // reset to allow re-selecting the same file
      input.value = "";
    }
  };

  return (
    <div class="px-3 sm:px-4 lg:px-6">
      <div class="max-w-[680px] mx-auto">
        <div class="bg-white dark:bg-neutral-900 border hairline rounded-md p-4">
          <h2 class="text-lg font-semibold mb-4">プロフィール編集</h2>
          <Show when={me()} fallback={<div class="text-muted">読み込み中…</div>}>
            <form class="grid gap-4" onSubmit={onSubmit}>
              <div class="flex items-center gap-4">
                <img
                  src={avatarUrl() || ""}
                  alt="アバター"
                  class="w-16 h-16 rounded-full bg-gray-200 dark:bg-neutral-700 object-cover"
                />
                <div class="flex-1">
                  <label class="block text-sm text-muted mb-1">表示名</label>
                  <input
                    class="w-full border hairline rounded px-3 py-2 bg-white dark:bg-neutral-900"
                    value={displayName()}
                    onInput={(e) =>
                      setDisplayName((e.target as HTMLInputElement).value)}
                    placeholder="表示名"
                  />
                </div>
              </div>
              <div class="grid gap-1">
                <label class="text-sm text-muted">ユーザーID</label>
                <input
                  class="w-full border hairline rounded px-3 py-2 bg-white dark:bg-neutral-900"
                  value={handle()}
                  onInput={(e) => setHandle((e.target as HTMLInputElement).value)}
                  placeholder="例: yuruko_123"
                />
                <p class="text-xs text-muted">
                  半角英数字とアンダースコアで3〜20文字です。プロフィールURLにも使用されます。
                </p>
              </div>
              <div class="grid gap-2">
                <div class="flex items-center gap-2">
                  <label class="text-sm text-muted">アバター画像</label>
                  <Show when={uploading()}>
                    <span class="text-sm text-muted">アップロード中...</span>
                  </Show>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                  <label class="inline-flex items-center gap-2 px-3 py-2 rounded border hairline cursor-pointer bg-white dark:bg-neutral-900">
                    <input
                      type="file"
                      accept="image/*"
                      class="hidden"
                      onChange={onPickAvatar}
                    />
                    <span class="text-sm">ファイルから選択</span>
                  </label>
                  <Show when={avatarUrl()}>
                    <div class="flex items-center gap-2">
                      <img
                        src={avatarUrl()}
                        alt="アバターのプレビュー"
                        class="w-12 h-12 rounded-full object-cover"
                      />
                      <button
                        type="button"
                        class="px-3 py-2 text-sm rounded border hairline"
                        onClick={() => setAvatarUrl("")}
                      >
                        クリア
                      </button>
                    </div>
                  </Show>
                </div>
              </div>
              <Show when={error()}>
                <div class="text-red-600 text-sm">{error()}</div>
              </Show>
              <div class="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={saving()}
                  class="px-4 py-2 rounded bg-black text-white disabled:opacity-60"
                >
                  {saving() ? "保存中..." : "保存"}
                </button>
                <a href="/profile" class="px-4 py-2 rounded border hairline">
                  キャンセル
                </a>
              </div>
            </form>
          </Show>
        </div>
      </div>
    </div>
  );
}
