import { Show, createSignal, onMount } from "solid-js";
import { useLocation, useNavigate } from "@solidjs/router";
import {
  loginWithPassword,
  refreshAuth,
  setJWT,
} from "../lib/api";

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const [handle, setHandle] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [error, setError] = createSignal("");
  const [submitting, setSubmitting] = createSignal(false);

  const searchParams = new URLSearchParams(location.search);
  const redirectParam = searchParams.get("redirect");
  const redirectTarget =
    redirectParam && redirectParam.startsWith("/")
      ? redirectParam
      : "/friends";
  const isAddAccountFlow = searchParams.get("addAccount") === "1";

  onMount(async () => {
    if (isAddAccountFlow) {
      return;
    }
    try {
      const ok = await refreshAuth();
      if (ok) {
        navigate(redirectTarget, { replace: true });
      }
    } catch (error) {
      console.warn("failed to refresh auth", error);
    }
  });

  const handleSubmit = async (event: Event) => {
    event.preventDefault();
    setError("");
    if (!handle()) {
      setError("ハンドルを入力してください。");
      return;
    }
    if (!password()) {
      setError("パスワードを入力してください。");
      return;
    }
    setSubmitting(true);
    try {
      const result = await loginWithPassword({
        handle: handle(),
        password: password(),
      });
      const token = typeof (result as any)?.token === "string" ? (result as any).token : null;
      if (token) {
        setJWT(token);
      }
      const ok = await refreshAuth();
      if (ok) {
        navigate(redirectTarget, { replace: true });
        return;
      }
      throw new Error("認証に失敗しました。");
    } catch (err: any) {
      const message =
        err?.data?.error ||
        err?.message ||
        "サインインに失敗しました。";
      setError(String(message));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div class="min-h-dvh bg-gradient-to-br from-slate-100 via-slate-50 to-white dark:from-neutral-950 dark:via-neutral-950 dark:to-neutral-950 flex items-center justify-center px-6 py-12">
      <div class="w-full max-w-md space-y-6">
        <div class="text-center space-y-2">
          <div class="text-3xl font-bold text-slate-900 dark:text-slate-100">
            YuruCommu
          </div>
          <p class="text-sm text-slate-500 dark:text-slate-400">
            ゆるいコミュニティと再会しましょう
          </p>
        </div>

        <div class="rounded-3xl bg-white dark:bg-neutral-900 px-8 py-10 shadow-lg shadow-slate-900/5 dark:shadow-slate-100/5">
          <div class="space-y-2 mb-6 text-center">
            <h2 class="text-xl font-semibold text-slate-900 dark:text-slate-100">
              {isAddAccountFlow ? "アカウントを追加" : "ログイン"}
            </h2>
            <Show when={isAddAccountFlow}>
              <p class="text-xs text-slate-500 dark:text-slate-400">
                現在のセッションは維持されます。追加後はプロフィールのアカウント一覧から切り替えできます。
              </p>
            </Show>
          </div>

          <form class="space-y-4 text-left" onSubmit={handleSubmit}>
            <label class="block text-sm font-medium text-slate-600 dark:text-slate-300">
              ユーザーハンドル
              <input
                type="text"
                class="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-neutral-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-500"
                placeholder="例: alice"
                value={handle()}
                onInput={(ev) => setHandle(ev.currentTarget.value.trim().toLowerCase())}
                autocomplete="username"
              />
            </label>
            <label class="block text-sm font-medium text-slate-600 dark:text-slate-300">
              パスワード
              <input
                type="password"
                class="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-neutral-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-500"
                value={password()}
                onInput={(ev) => setPassword(ev.currentTarget.value)}
                autocomplete="current-password"
              />
            </label>

            <button
              type="submit"
              class="w-full inline-flex items-center justify-center gap-2 rounded-full bg-slate-900 dark:bg-slate-100 px-5 py-3 text-sm font-semibold text-white dark:text-slate-900 transition hover:bg-slate-800 dark:hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={submitting()}
            >
              <Show
                when={submitting()}
                fallback={<span>ログイン</span>}
              >
                <span class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 dark:border-slate-900/40 border-t-white dark:border-t-slate-900" />
                <span>サインイン中...</span>
              </Show>
            </button>
            <Show when={error()}>
              <p class="text-xs text-red-500 dark:text-red-400">{error()}</p>
            </Show>
          </form>
        </div>
      </div>
    </div>
  );
}
