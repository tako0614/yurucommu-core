import {
  createEffect,
  createResource,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { apiFetch } from "../../utils/config.ts";
import { Button } from "../ui/index.ts";

interface CapabilityInfo {
  version: string;
  enabled: boolean;
}

interface FaspProvider {
  name: string;
  baseUrl: string;
  serverId: string;
  status: string;
  capabilities: Record<string, CapabilityInfo>;
}

async function fetchProviders(): Promise<FaspProvider[]> {
  const res = await apiFetch("/api/fasp/providers");
  if (!res.ok) throw new Error("FASP一覧の取得に失敗しました");
  return await res.json();
}

export function FaspProviders() {
  const [providers, { refetch }] = createResource(fetchProviders);
  const [target, setTarget] = createSignal("");
  const [submitting, setSubmitting] = createSignal(false);
  const [searchServerId, setSearchServerId] = createSignal<string | "">("");
  const [shareEnabled, setShareEnabled] = createSignal(true);
  const [shareServerIds, setShareServerIds] = createSignal<string[]>([]);
  const [loadingSettings, setLoadingSettings] = createSignal(false);

  const toggleCapability = async (
    p: FaspProvider,
    id: string,
  ) => {
    const caps = { ...p.capabilities };
    const current = caps[id];
    caps[id] = { ...current, enabled: !current.enabled };
    await apiFetch(`/api/fasp/providers/${p.serverId}/capabilities`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capabilities: caps }),
    });
    refetch();
  };

  // 承認/却下はサーバー側の署名付き登録フローで自動更新するため、
  // クライアント側からの明示承認・却下操作は提供しない。

  const removeProvider = async (p: FaspProvider) => {
    if (!confirm(`${p.name || p.baseUrl} を削除します。よろしいですか？`)) {
      return;
    }
    const res = await apiFetch(`/api/fasp/providers/${p.serverId}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const t = await res.text();
      alert(`削除に失敗しました: ${t}`);
    }
    refetch();
  };

  const discover = async () => {
    const domainOrUrl = target().trim();
    if (!domainOrUrl) return;
    setSubmitting(true);
    try {
      const res = await apiFetch("/api/fasp/providers/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domainOrUrl }),
      });
      if (!res.ok) {
        const t = await res.text();
        alert(`追加に失敗しました: ${t}`);
      } else {
        setTarget("");
        refetch();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const loadSettings = async () => {
    setLoadingSettings(true);
    try {
      const res = await apiFetch("/api/fasp/settings");
      if (res.ok) {
        const s = await res.json();
        setSearchServerId(s.searchServerId || "");
        setShareEnabled(s.shareEnabled !== false);
        setShareServerIds(
          Array.isArray(s.shareServerIds) ? s.shareServerIds : [],
        );
      }
    } finally {
      setLoadingSettings(false);
    }
  };

  const saveSettings = async () => {
    const body: Record<string, unknown> = {
      searchServerId: searchServerId() || null,
      shareEnabled: shareEnabled(),
    };
    body.shareServerIds = shareServerIds().length > 0 ? shareServerIds() : null;
    const res = await apiFetch("/api/fasp/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const t = await res.text();
      alert(`保存に失敗しました: ${t}`);
    } else {
      globalThis.dispatchEvent(
        new CustomEvent("app:toast", {
          detail: {
            type: "success",
            title: "保存しました",
            description: "設定が更新されました",
          },
        }),
      );
    }
  };

  onMount(() => {
    loadSettings();
  });

  // 自動承認の反映: 承認待ちのプロバイダがある間は定期的に再取得
  let pollTimer: number | undefined;
  const startPolling = () => {
    if (pollTimer) return;
    pollTimer = setInterval(() => {
      const list = providers();
      const hasPending = Array.isArray(list) &&
        list.some((p) => p.status !== "approved");
      if (hasPending) {
        refetch();
      } else {
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = undefined;
        }
      }
    }, 5000) as unknown as number;
  };
  const stopPolling = () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
  };

  createEffect(() => {
    const list = providers();
    if (!Array.isArray(list)) return;
    const hasPending = list.some((p) => p.status !== "approved");
    if (hasPending) startPolling();
    else stopPolling();
  });

  onCleanup(() => stopPolling());

  return (
    <div class="space-y-4">
      <div class="border border-[#3a3a3a] rounded p-3 space-y-2">
        <div class="font-bold">FASP を追加</div>
        <div class="flex gap-2 items-center">
          <input
            type="text"
            class="flex-1 bg-transparent border border-[#3a3a3a] rounded px-2 py-1"
            placeholder="fasp.example.com または https://fasp.example.com"
            value={target()}
            onInput={(e) => setTarget(e.currentTarget.value)}
          />
          <Button type="button" disabled={submitting()} onClick={discover}>
            {submitting() ? "追加中…" : "追加"}
          </Button>
        </div>
        <p class="text-xs text-[#9a9a9a]">
          入力したドメイン/URL の /provider_info を取得して仮登録します。 後で
          FASP 側からの登録リクエストが届いたら承認してください。
        </p>
      </div>
      <Show when={providers()?.length === 0}>
        <p>登録されたFASPはありません</p>
      </Show>
      <div class="border border-[#3a3a3a] rounded p-3 space-y-3">
        <div class="font-bold">FASP 利用設定</div>
        <div class="flex items-center gap-2">
          <label class="w-40 text-sm text-[#bbb]">検索に使うFASP</label>
          <select
            class="flex-1 bg-transparent border border-[#3a3a3a] rounded px-2 py-1"
            disabled={loadingSettings()}
            value={searchServerId()}
            onChange={(e) => setSearchServerId(e.currentTarget.value)}
          >
            <option value="">自動選択（承認済み・有効なもの）</option>
            <For each={providers() || []}>
              {(p) => (
                <option value={p.serverId} disabled={p.status !== "approved"}>
                  {p.name || p.baseUrl}{" "}
                  {p.status !== "approved" ? "(承認待ち)" : ""}
                </option>
              )}
            </For>
          </select>
        </div>
        <div class="flex items-center gap-2">
          <label class="w-40 text-sm text-[#bbb]">投稿をFASPに共有</label>
          <input
            type="checkbox"
            checked={shareEnabled()}
            onChange={(e) => setShareEnabled(e.currentTarget.checked)}
          />
        </div>
        <div class="space-y-1">
          <div class="text-sm text-[#bbb]">
            共有対象（任意選択、未選択=全承認済み）
          </div>
          <div class="grid gap-1">
            <For each={providers() || []}>
              {(p) => (
                <label class="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    disabled={!shareEnabled() || p.status !== "approved"}
                    checked={shareServerIds().includes(p.serverId)}
                    onChange={(e) => {
                      const id = p.serverId;
                      setShareServerIds((prev) => {
                        const set = new Set(prev);
                        if (e.currentTarget.checked) set.add(id);
                        else set.delete(id);
                        return Array.from(set);
                      });
                    }}
                  />
                  <span>
                    {p.name || p.baseUrl}
                    {p.status !== "approved" ? " (承認待ち)" : ""}
                  </span>
                </label>
              )}
            </For>
          </div>
        </div>
        <div class="flex justify-end">
          <Button onClick={saveSettings}>保存</Button>
        </div>
      </div>
      <For each={providers() || []}>
        {(p) => (
          <div class="border border-[#3a3a3a] rounded p-3 space-y-2">
            <div class="font-bold">{p.name || p.baseUrl}</div>
            <div class="text-sm">状態: {p.status}</div>
            <div class="space-y-1">
              <For each={Object.entries(p.capabilities)}>
                {([id, info]) => (
                  <label class="flex items-center gap-2 opacity-100">
                    <input
                      type="checkbox"
                      checked={info.enabled}
                      disabled={p.status !== "approved"}
                      onChange={() => toggleCapability(p, id)}
                    />
                    <span>
                      {id} v{info.version}
                      {p.status !== "approved" && (
                        <span class="text-xs text-[#9a9a9a] ml-2">
                          (承認待ちのため変更不可)
                        </span>
                      )}
                    </span>
                  </label>
                )}
              </For>
            </div>
            <div class="flex gap-2 pt-2">
              <Button
                type="button"
                variant="danger"
                onClick={() => removeProvider(p)}
              >
                削除
              </Button>
            </div>
          </div>
        )}
      </For>
    </div>
  );
}
