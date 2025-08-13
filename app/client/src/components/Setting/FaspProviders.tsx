import { createResource, createSignal, For, Show } from "solid-js";
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
