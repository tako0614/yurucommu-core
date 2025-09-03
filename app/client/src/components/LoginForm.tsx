import { createSignal, onMount, Show } from "solid-js";
import { TauriLogin } from "./TauriLogin.tsx";
import {
  addServer,
  apiFetch,
  getOrigin,
  isTauri,
  setActiveServer,
  setApiBase,
} from "../utils/config.ts";
import { Button, Card, Input } from "./ui/index.ts";

interface LoginFormProps {
  onLoginSuccess: () => void;
}

export function LoginForm(props: LoginFormProps) {
  const [loginPassword, setLoginPassword] = createSignal("");
  const [error, setError] = createSignal("");
  const [isLoading, setIsLoading] = createSignal(false);
  const [serverUrl, setServerUrl] = createSignal("");
  const inTauri = isTauri();
  const [oauthHost, setOauthHost] = createSignal<string | null>(null);
  // サーバー側フローのみ使用のため、クライアント側ではクライアントID/シークレットを保持しない

  onMount(async () => {
    try {
      const res = await apiFetch("/api/config");
      if (res.ok) {
        const data = await res.json();
        setOauthHost(data.oauthHost ?? null);
  // クライアントIDはクライアント側では使用しない
      }
    } catch {
      // ignore
    }

  // OAuth コード処理はサーバー側に一本化（/api/login/oauth/prepare でURL取得 → authorize → callback → セッション発行）
  });

  onMount(() => {
    if (inTauri) {
      setServerUrl("");
    }
  });

  const loginToServer = async (url: string, password: string) => {
    setError("");
    // ブラウザ環境ではサーバーURLが不要なのでスキップ
    if (!inTauri && !url) {
      // ブラウザ環境では現在のホストを使用
      url = getOrigin();
    }
    if (inTauri && !url) {
      setError("サーバーURLを入力してください");
      return;
    }
    if (!password) {
      setError("ログイン用パスワードを入力してください");
      return;
    }
    setApiBase(url);
    addServer(url);
    setActiveServer(url);
    setIsLoading(true);
    try {
      const res = await apiFetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const results = await res.json();
      if (results.success) {
        props.onLoginSuccess();
      } else {
        setError(results.error || "ログインに失敗しました");
      }
    } catch (err) {
      console.error("Login request failed:", err);
      setError("通信エラーが発生しました");
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogin = async (e: Event) => {
    e.preventDefault();
    await loginToServer(serverUrl(), loginPassword());
  };

  const loginWithOAuth = () => {
    // クライアント主導: まず /api/login/oauth/prepare で authorizeUrl を取得し遷移
    (async () => {
      try {
        const res = await fetch("/api/login/oauth/prepare", {
          cache: "no-store",
          headers: { "Accept": "application/json", "Cache-Control": "no-store" },
        });
        if (res.ok) {
          const data = await res.json();
          const loc = (data && typeof data.authorizeUrl === "string") ? data.authorizeUrl : "";
          if (loc) {
            globalThis.location.assign(loc);
            return;
          }
        }
      } catch { /* ignore */ }
      // 失敗時フォールバック（サーバ側 302 経路を試す）
      globalThis.location.href = "/api/login/oauth/start";
    })();
  };

  return (
    <>
      {isTauri()
        ? <TauriLogin onLoginSuccess={props.onLoginSuccess} />
        : (
          <div class="min-h-screen flex flex-col bg-[var(--color-bg)] text-gray-100">
            <main class="flex-grow flex items-center justify-center px-4 py-12">
              <Card class="w-full max-w-md">
                <div class="mb-6 text-center">
                  <h2 class="text-3xl font-semibold mb-2">ようこそ</h2>
                  <p class="text-gray-400">
                    ActivityPubでWeb自主するためのソフトウェア
                  </p>
                </div>
                <p class="text-gray-400 text-sm leading-relaxed mb-6">
                  1人のユーザーが他のユーザーとコミュニケーションを取るためのActivityPubに対応したソフトウェアです。シンプルで使いやすいインターフェースを提供します。
                </p>
                <form onSubmit={handleLogin} class="space-y-5">
                  <Input
                    id="loginPassword"
                    type="password"
                    value={loginPassword()}
                    onInput={(e) => setLoginPassword(e.currentTarget.value)}
                    label="ログイン用パスワード"
                    placeholder="パスワードを入力"
                    disabled={isLoading()}
                    required
                  />
                  <Show when={error()}>
                    <p class="text-rose-400 text-sm font-medium bg-rose-900/30 p-3 rounded-md">
                      {error()}
                    </p>
                  </Show>
                  <Button type="submit" class="w-full" loading={isLoading()}>
                    {isLoading() ? "ログイン処理中..." : "ログイン"}
                  </Button>
                  <Show when={oauthHost()}>
                    <Button
                      type="button"
                      variant="secondary"
                      class="w-full inline-flex items-center justify-center gap-2"
                      onClick={loginWithOAuth}
                    >
                      takos hostでログイン
                    </Button>
                  </Show>
                </form>
              </Card>
            </main>
            <footer class="py-6 border-t border-[var(--color-border)]">
              <div class="container mx-auto px-4 text-center">
                <p class="text-gray-500 text-sm">
                  © 2023 takos. All rights reserved.
                </p>
              </div>
            </footer>
          </div>
        )}
    </>
  );
}
