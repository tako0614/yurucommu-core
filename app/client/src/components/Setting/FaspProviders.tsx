import { createResource, For, Show } from "solid-js";
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

  const approve = async (p: FaspProvider) => {
    await apiFetch(`/api/fasp/providers/${p.serverId}/approve`, {
      method: "POST",
    });
    refetch();
  };

  const reject = async (p: FaspProvider) => {
    await apiFetch(`/api/fasp/providers/${p.serverId}/reject`, {
      method: "POST",
    });
    refetch();
  };

  return (
    <div class="space-y-4">
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
                  <label class="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={info.enabled}
                      onChange={() => toggleCapability(p, id)}
                    />
                    <span>{id} v{info.version}</span>
                  </label>
                )}
              </For>
            </div>
            <div class="flex gap-2 pt-2">
              <Button type="button" onClick={() => approve(p)}>
                承認
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => reject(p)}
              >
                却下
              </Button>
            </div>
          </div>
        )}
      </For>
    </div>
  );
}
