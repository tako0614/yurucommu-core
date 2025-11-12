import { Show, createEffect, createMemo, createSignal } from "solid-js";
import { useLocation, useNavigate } from "@solidjs/router";
import { updateMe, uploadMedia, useMe } from "../lib/api";

const HANDLE_PATTERN = /^[a-z0-9_]{3,20}$/;

function sanitizeRedirect(path: string | null): string {
  if (!path) return "/";
  try {
    const decoded = decodeURIComponent(path);
    if (decoded.startsWith("/") && !decoded.startsWith("//")) {
      return decoded === "/login" || decoded.startsWith("/onboarding")
        ? "/"
        : decoded;
    }
  } catch {
    // ignore malformed encodings
  }
  return "/";
}

export default function Onboarding() {
  const me = useMe();
  const navigate = useNavigate();
  const location = useLocation();
  const [handle, setHandle] = createSignal("");
  const [displayName, setDisplayName] = createSignal("");
  const [avatarUrl, setAvatarUrl] = createSignal("");
  const [saving, setSaving] = createSignal(false);
  const [uploading, setUploading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const redirectTarget = createMemo(() => {
    const params = new URLSearchParams(location.search);
    return sanitizeRedirect(params.get("redirect"));
  });

  let initialized = false;
  createEffect(() => {
    const user = me();
    if (!user) return;
    if (user.profile_completed_at) {
      navigate(redirectTarget(), { replace: true });
      return;
    }
    if (!initialized) {
      setHandle("");
      setDisplayName(user.display_name || "");
      setAvatarUrl(user.avatar_url || "");
      initialized = true;
    }
  });

  const isHandleValid = createMemo(() =>
    HANDLE_PATTERN.test(handle().trim().toLowerCase()),
  );
  const canSubmit = createMemo(() =>
    isHandleValid() && displayName().trim().length > 0 && !saving() && !uploading(),
  );

  const onSubmit = async (e: Event) => {
    e.preventDefault();
    if (!isHandleValid()) {
      setError("IDは半角英数字とアンダースコアで3〜20文字にしてください");
      return;
    }
    if (!displayName().trim()) {
      setError("ニックネームを入力してください");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateMe({
        handle: handle().trim().toLowerCase(),
        display_name: displayName().trim(),
        avatar_url: avatarUrl(),
      });
      navigate(redirectTarget(), { replace: true });
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
        setError("保存に失敗しました");
      }
    } finally {
      setSaving(false);
    }
  };

  const onPickAvatar = async (event: Event) => {
    const input = event.target as HTMLInputElement;
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
      input.value = "";
    }
  };

  return (
    <div class="min-h-dvh flex items-center justify-center bg-slate-50 dark:bg-neutral-950 px-4 py-10">
      <div class="w-full max-w-lg bg-white dark:bg-neutral-900 border hairline rounded-3xl shadow-sm px-6 sm:px-10 py-10">
        <h1 class="text-2xl font-semibold text-center">はじめにプロフィールを設定しましょう</h1>
        <p class="mt-2 text-sm text-muted text-center">
          IDとニックネーム、アイコン画像を設定すると友だちに見つけてもらいやすくなります。
        </p>
        <Show
          when={me()}
          fallback={<div class="mt-10 text-center text-muted">読み込み中...</div>}
        >
          <form class="mt-8 grid gap-6" onSubmit={onSubmit}>
            <div class="flex flex-col items-center gap-4">
              <img
                src={avatarUrl() || ""}
                alt="アバター"
                class="w-24 h-24 rounded-full bg-gray-200 dark:bg-neutral-700 object-cover"
              />
              <div class="flex flex-wrap items-center justify-center gap-3">
                <label class="inline-flex items-center gap-2 px-3 py-2 rounded-full border hairline cursor-pointer bg-white dark:bg-neutral-900">
                  <input
                    type="file"
                    accept="image/*"
                    class="hidden"
                    onChange={onPickAvatar}
                  />
                  <span class="text-sm">画像を選択</span>
                </label>
                <Show when={avatarUrl()}>
                  <button
                    type="button"
                    class="px-3 py-2 text-sm rounded-full border hairline"
                    onClick={() => setAvatarUrl("")}
                  >
                    画像をクリア
                  </button>
                </Show>
                <Show when={uploading()}>
                  <span class="text-xs text-muted">アップロード中...</span>
                </Show>
              </div>
            </div>
            <div class="grid gap-2">
              <label class="text-sm font-medium">ID</label>
              <input
                type="text"
                value={handle()}
                onInput={(e) => setHandle((e.target as HTMLInputElement).value)}
                class="w-full rounded-lg border hairline px-4 py-2 bg-white dark:bg-neutral-900"
                placeholder="例: yuruko_123"
                autocomplete="off"
              />
              <p class="text-xs text-muted">
                半角英数字とアンダースコアで3〜20文字。あとから変更することもできます。
              </p>
              <Show when={handle() && !isHandleValid()}>
                <p class="text-xs text-red-500">使用できないIDです。</p>
              </Show>
            </div>
            <div class="grid gap-2">
              <label class="text-sm font-medium">ニックネーム</label>
              <input
                type="text"
                value={displayName()}
                onInput={(e) => setDisplayName((e.target as HTMLInputElement).value)}
                class="w-full rounded-lg border hairline px-4 py-2 bg-white dark:bg-neutral-900"
                placeholder="あなたの表示名"
              />
            </div>
            <Show when={error()}>
              <div class="text-sm text-red-500">{error()}</div>
            </Show>
            <button
              type="submit"
              disabled={!canSubmit()}
              class="w-full rounded-full bg-black text-white py-2 font-semibold disabled:opacity-50"
            >
              {saving() ? "保存中..." : "はじめる"}
            </button>
          </form>
        </Show>
      </div>
    </div>
  );
}
