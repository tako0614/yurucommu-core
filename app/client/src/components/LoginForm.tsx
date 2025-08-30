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
  const [oauthClientId, setOauthClientId] = createSignal<string | null>(null);
  const [oauthClientSecret, setOauthClientSecret] = createSignal<string | null>(
    null,
  );

  onMount(async () => {
    try {
      const res = await apiFetch("/api/config");
      if (res.ok) {
        const data = await res.json();
        setOauthHost(data.oauthHost ?? null);
        setOauthClientId(data.oauthClientId ?? null);
        setOauthClientSecret(data.oauthClientSecret ?? null);
      }
    } catch {
      // ignore
    }

    const params = new URLSearchParams(globalThis.location.search);
    const code = params.get("code");
    if (code && oauthHost() && oauthClientId() && oauthClientSecret()) {
      const base = oauthHost()?.startsWith("http")
        ? oauthHost()!
        : `https://${oauthHost()}`;
      const redirect = getOrigin();
      const form = new URLSearchParams();
      form.set("grant_type", "authorization_code");
      form.set("code", code);
      form.set("client_id", oauthClientId()!);
      form.set("client_secret", oauthClientSecret()!);
      form.set("redirect_uri", redirect);
      try {
        const tokenRes = await fetch(`${base}/oauth/token`, {
          method: "POST",
          body: form,
        });
        if (tokenRes.ok) {
          const tokenData = await tokenRes.json();
          const loginRes = await apiFetch("/api/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ accessToken: tokenData.access_token }),
          });
          const loginData = await loginRes.json();
          if (loginData.success) {
            props.onLoginSuccess();
          } else {
            setError(loginData.error || "OAuthログインに失敗しました2");
          }
        } else {
          console.log(
            "OAuth token request failed:",
            tokenRes.status,
            await tokenRes.text(),
          );
          setError("OAuthトークン取得に失敗しました1");
        }
      } catch {
        setError("通信エラーが発生しました");
      }
      params.delete("code");
      const q = params.toString();
      const url = q
        ? `${globalThis.location.pathname}?${q}`
        : globalThis.location.pathname;
      history.replaceState(null, "", url);
    }
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
    // サーバー側フローに委譲（正しいredirect_uriとstateをサーバーが管理）
    globalThis.location.href = "/api/login/oauth/start";
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
                      {/* Google ロゴ (装飾用) */}
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" class="w-5 h-5">
                        <path fill="#FFC107" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12 s5.373-12,12-12c3.059,0,5.842,1.154,7.938,3.062l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24 s8.955,20,20,20s20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"/>
                        <path fill="#FF3D00" d="M6.306,14.691l6.571,4.818C14.655,16.108,18.961,13,24,13c3.059,0,5.842,1.154,7.938,3.062 l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.59,8.337,6.306,14.691z"/>
                        <path fill="#4CAF50" d="M24,44c5.166,0,9.86-1.977,13.409-5.193l-6.191-5.238C29.211,35.091,26.715,36,24,36 c-5.192,0-9.607-3.317-11.27-7.946l-6.522,5.024C9.423,39.556,16.13,44,24,44z"/>
                        <path fill="#1976D2" d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.094,5.569 c0.001-0.001,0.002-0.001,0.003-0.002l6.191,5.238C36.971,39.205,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z"/>
                      </svg>
                      Google でログイン
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
