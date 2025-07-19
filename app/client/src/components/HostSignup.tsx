import { createSignal, Show } from "solid-js";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import {
  addServer,
  isTauri,
  setActiveServer,
  setApiBase,
} from "../utils/config.ts";

const HOST_URL = "https://takos.jp";

function hostFetch(path: string, init?: RequestInit) {
  const url = `${HOST_URL}${path}`;
  if (isTauri()) return tauriFetch(url, { ...init, credentials: "include" });
  return fetch(url, { ...init, credentials: "include" });
}

export function HostSignup(props: { onClose: () => void }) {
  const [step, setStep] = createSignal<"register" | "verify" | "create">(
    "register",
  );
  const [userName, setUserName] = createSignal("");
  const [email, setEmail] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [code, setCode] = createSignal("");
  const [subdomain, setSubdomain] = createSignal("");
  const [error, setError] = createSignal("");
  const [loading, setLoading] = createSignal(false);

  const register = async (e: Event) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const res = await hostFetch("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userName: userName(),
        email: email(),
        password: password(),
        accepted: true,
      }),
    });
    setLoading(false);
    if (res.ok) {
      setStep("verify");
    } else {
      setError("登録に失敗しました");
    }
  };

  const verify = async (e: Event) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const res = await hostFetch("/auth/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userName: userName(), code: code() }),
    });
    setLoading(false);
    if (res.ok) {
      setStep("create");
    } else {
      setError("確認に失敗しました");
    }
  };

  const createInstance = async (e: Event) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const res = await hostFetch("/user/instances", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: subdomain() }),
    });
    if (!res.ok) {
      setLoading(false);
      setError("インスタンス作成に失敗しました");
      return;
    }
    const data = await res.json();
    const fullHost = data.host as string;
    const url = `https://${fullHost}`;
    addServer(url);
    setActiveServer(url);
    setApiBase(url);
    setLoading(false);
    props.onClose();
    globalThis.location.href = `${HOST_URL}/oauth/authorize?client_id=${
      encodeURIComponent(url)
    }&redirect_uri=${encodeURIComponent(url)}`;
  };

  return (
    <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div class="bg-[#212121] p-8 rounded-lg w-full max-w-md text-gray-100 space-y-6">
        <Show when={step() === "register"}>
          <form onSubmit={register} class="space-y-4">
            <h3 class="text-xl font-bold text-center">
              takos.jp アカウント作成
            </h3>
            <div>
              <label for="hs-user" class="block text-sm mb-1">ユーザー名</label>
              <input
                id="hs-user"
                required
                value={userName()}
                onInput={(e) => setUserName(e.currentTarget.value)}
                class="w-full bg-gray-700 rounded px-3 py-2"
              />
            </div>
            <div>
              <label for="hs-mail" class="block text-sm mb-1">
                メールアドレス
              </label>
              <input
                id="hs-mail"
                type="email"
                required
                value={email()}
                onInput={(e) => setEmail(e.currentTarget.value)}
                class="w-full bg-gray-700 rounded px-3 py-2"
              />
            </div>
            <div>
              <label for="hs-pass" class="block text-sm mb-1">パスワード</label>
              <input
                id="hs-pass"
                type="password"
                required
                value={password()}
                onInput={(e) => setPassword(e.currentTarget.value)}
                class="w-full bg-gray-700 rounded px-3 py-2"
              />
            </div>
            <Show when={error()}>
              <p class="text-red-400 text-sm">{error()}</p>
            </Show>
            <div class="flex justify-end gap-2">
              <button
                type="button"
                onClick={props.onClose}
                class="px-4 py-2 bg-gray-600 rounded"
              >
                閉じる
              </button>
              <button
                type="submit"
                class="px-4 py-2 bg-green-600 rounded text-white"
                disabled={loading()}
              >
                登録
              </button>
            </div>
          </form>
        </Show>
        <Show when={step() === "verify"}>
          <form onSubmit={verify} class="space-y-4">
            <h3 class="text-xl font-bold text-center">確認コード入力</h3>
            <p class="text-sm text-gray-400">
              メールに記載された6桁のコードを入力してください
            </p>
            <div>
              <label for="hs-code" class="block text-sm mb-1">コード</label>
              <input
                id="hs-code"
                required
                value={code()}
                onInput={(e) => setCode(e.currentTarget.value)}
                class="w-full bg-gray-700 rounded px-3 py-2"
              />
            </div>
            <Show when={error()}>
              <p class="text-red-400 text-sm">{error()}</p>
            </Show>
            <div class="flex justify-end gap-2">
              <button
                type="button"
                onClick={props.onClose}
                class="px-4 py-2 bg-gray-600 rounded"
              >
                閉じる
              </button>
              <button
                type="submit"
                class="px-4 py-2 bg-green-600 rounded text-white"
                disabled={loading()}
              >
                確認
              </button>
            </div>
          </form>
        </Show>
        <Show when={step() === "create"}>
          <form onSubmit={createInstance} class="space-y-4">
            <h3 class="text-xl font-bold text-center">インスタンス作成</h3>
            <div class="flex items-center gap-2">
              <input
                required
                value={subdomain()}
                onInput={(e) => setSubdomain(e.currentTarget.value)}
                class="flex-grow bg-gray-700 rounded px-3 py-2"
                placeholder="サブドメイン"
              />
              <span class="text-gray-400">.takos.jp</span>
            </div>
            <Show when={error()}>
              <p class="text-red-400 text-sm">{error()}</p>
            </Show>
            <div class="flex justify-end gap-2">
              <button
                type="button"
                onClick={props.onClose}
                class="px-4 py-2 bg-gray-600 rounded"
              >
                閉じる
              </button>
              <button
                type="submit"
                class="px-4 py-2 bg-green-600 rounded text-white"
                disabled={loading()}
              >
                作成
              </button>
            </div>
          </form>
        </Show>
      </div>
    </div>
  );
}

export default HostSignup;
