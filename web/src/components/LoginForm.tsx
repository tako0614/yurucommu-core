import { createSignal, For, onMount, Show } from "solid-js";
import type { JSX } from "solid-js";
import { apiFetch } from "../lib/api/fetch.ts";

interface OAuthProvider {
  id: string;
  name: string;
  icon: string;
}

interface AuthConfig {
  providers: OAuthProvider[];
  password_enabled: boolean;
}

interface LoginFormProps {
  onLogin: (password: string) => Promise<boolean>;
  error: string | null;
}

// Provider icons (inline SVG)
const ProviderIcons: Record<string, JSX.Element> = {
  google: (
    <svg viewBox="0 0 24 24" class="w-5 h-5">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  ),
  x: (
    <svg viewBox="0 0 24 24" class="w-5 h-5" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  ),
  takos: (
    <svg viewBox="0 0 24 24" class="w-5 h-5" fill="currentColor">
      <circle cx="12" cy="12" r="10" fill="#10B981" />
      <text
        x="12"
        y="16"
        text-anchor="middle"
        font-size="10"
        fill="white"
        font-weight="bold"
      >
        T
      </text>
    </svg>
  ),
};

export function LoginForm(props: LoginFormProps) {
  const [password, setPassword] = createSignal("");
  const [submitting, setSubmitting] = createSignal(false);
  const [authConfig, setAuthConfig] = createSignal<AuthConfig | null>(null);
  const [loading, setLoading] = createSignal(true);

  onMount(() => {
    apiFetch("/api/auth/providers")
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Failed to load auth providers: ${res.status}`);
        }
        return await res.json() as AuthConfig;
      })
      .then((data) => {
        setAuthConfig(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load auth providers:", err);
        // Fallback to password only
        setAuthConfig({ providers: [], password_enabled: true });
        setLoading(false);
      });
  });

  const handleSubmit = async (e: SubmitEvent) => {
    e.preventDefault();
    if (!password()) return;

    setSubmitting(true);
    await props.onLogin(password());
    setSubmitting(false);
  };

  const hasOAuth = () => {
    const config = authConfig();
    return config && config.providers.length > 0;
  };
  const hasPassword = () => authConfig()?.password_enabled;

  return (
    <Show
      when={!loading()}
      fallback={
        <div class="w-full max-w-sm flex justify-center py-8">
          <div class="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <Show
        when={hasOAuth() || hasPassword()}
        fallback={
          <div class="w-full max-w-sm text-center text-neutral-400">
            <p>認証方法が設定されていません。</p>
            <p class="text-sm mt-2">管理者に連絡してください。</p>
          </div>
        }
      >
        <div class="w-full max-w-sm space-y-6">
          {/* OAuth Providers */}
          <Show when={hasOAuth()}>
            <div class="space-y-3">
              <For each={authConfig()!.providers}>
                {(provider) => (
                  <a
                    href={`/api/auth/login/${provider.id}`}
                    class="w-full flex items-center justify-center gap-3 px-4 py-3 bg-neutral-800 border border-neutral-700 rounded-md text-neutral-100 hover:bg-neutral-700 transition-colors"
                  >
                    {ProviderIcons[provider.id] || (
                      <span class="w-5 h-5 bg-neutral-600 rounded-full" />
                    )}
                    <span>{provider.name}でログイン</span>
                  </a>
                )}
              </For>
            </div>
          </Show>

          {/* Divider */}
          <Show when={hasOAuth() && hasPassword()}>
            <div class="relative">
              <div class="absolute inset-0 flex items-center">
                <div class="w-full border-t border-neutral-700" />
              </div>
              <div class="relative flex justify-center text-sm">
                <span class="px-2 bg-neutral-900 text-neutral-500">または</span>
              </div>
            </div>
          </Show>

          {/* Password Form */}
          <Show when={hasPassword()}>
            <form onSubmit={handleSubmit} class="space-y-4">
              <div>
                <label
                  for="password"
                  class="block text-sm font-medium text-neutral-300 mb-1"
                >
                  パスワード
                </label>
                <input
                  id="password"
                  type="password"
                  value={password()}
                  onInput={(e) => setPassword(e.currentTarget.value)}
                  class="w-full px-4 py-2 bg-neutral-800 border border-neutral-700 rounded-md text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="パスワードを入力"
                  disabled={submitting()}
                  autocomplete="current-password"
                  autofocus={!hasOAuth()}
                />
              </div>

              <Show when={props.error}>
                <div class="text-red-400 text-sm bg-red-900/30 border border-red-800 rounded-md px-3 py-2">
                  {props.error}
                </div>
              </Show>

              <button
                type="submit"
                disabled={submitting() || !password()}
                class="w-full bg-blue-600 text-white px-6 py-3 rounded-md font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting() ? "ログイン中..." : "ログイン"}
              </button>
            </form>
          </Show>
        </div>
      </Show>
    </Show>
  );
}
