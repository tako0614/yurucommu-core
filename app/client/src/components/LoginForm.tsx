import { createSignal, onMount, Show } from "solid-js";
import { TauriLogin } from "./TauriLogin.tsx";
import { InitialSetupForm } from "./InitialSetupForm.tsx";
import {
  addServer,
  apiFetch,
  getOrigin,
  isTauri,
  setActiveServer,
  setApiBase,
} from "../utils/config.ts";
import { Button, Card, Input } from "./ui";

interface LoginFormProps {
  onLoginSuccess: () => void;
}

export function LoginForm(props: LoginFormProps) {
  const [loginPassword, setLoginPassword] = createSignal("");
  const [error, setError] = createSignal("");
  const [isLoading, setIsLoading] = createSignal(false);
  const [serverUrl, setServerUrl] = createSignal("");
  const inTauri = isTauri();
  const [showSetup, setShowSetup] = createSignal(false);
  const [oauthHost, setOauthHost] = createSignal<string | null>(null);
  const [oauthClientId, setOauthClientId] = createSignal<string | null>(null);
  const [oauthClientSecret, setOauthClientSecret] = createSignal<string | null>(
    null,
  );

  onMount(async () => {
    try {
      const st = await apiFetch("/api/setup/status");
      if (st.ok) {
        const data = await st.json();
        if (!data.configured) {
          setShowSetup(true);
          return;
        }
      }
    } catch {
      // ignore
    }

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
            try {
              const st2 = await apiFetch("/api/setup/status");
              if (st2.ok) {
                const d = await st2.json();
                if (!d.configured) {
                  setShowSetup(true);
                  return;
                }
              }
            } catch {
              // ignore
            }
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
    if (!url) {
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
        try {
          const st = await apiFetch("/api/setup/status");
          if (st.ok) {
            const data = await st.json();
            if (!data.configured) {
              setShowSetup(true);
              return;
            }
          }
        } catch {
          // ignore
        }
        props.onLoginSuccess();
      } else {
        if (results.error === "not_configured") {
          setShowSetup(true);
        } else {
          setError(results.error || "ログインに失敗しました");
        }
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
      <Show
        when={!showSetup()}
        fallback={
          <InitialSetupForm
            onSuccess={() => {
              setShowSetup(false);
              props.onLoginSuccess();
            }}
          />
        }
      >
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
                        class="w-full"
                        onClick={loginWithOAuth}
                      >
                        OAuthでログイン
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
      </Show>
    </>
  );
}
