import { Component, createResource, createSignal, For } from "solid-js";
import { addRelay, deleteRelay, fetchRelays, Relay } from "./relaysApi.ts";

const RelaySettings: Component = () => {
  const [relays, { mutate }] = createResource(fetchRelays);
  const [url, setUrl] = createSignal("");

  const onAdd = async () => {
    const inboxUrl = url().trim();
    if (!inboxUrl) return;
    const result = await addRelay(inboxUrl);
    if (result) {
      mutate((prev) => [...(prev ?? []), result]);
      setUrl("");
    }
  };

  const onDelete = async (id: string) => {
    const ok = await deleteRelay(id);
    if (ok) {
      mutate((prev) => prev?.filter((r) => r.id !== id) ?? []);
    }
  };

  return (
    <div class="space-y-2">
      <h3 class="text-xl font-bold">リレーサーバー設定</h3>
      <div class="flex space-x-2">
        <input
          class="flex-1 px-2 py-1 border rounded"
          type="text"
          placeholder="Relay inbox URL"
          value={url()}
          onInput={(e) => setUrl(e.currentTarget.value)}
        />
        <button
          type="button"
          class="px-3 py-1 bg-blue-500 text-white rounded"
          onClick={onAdd}
        >
          追加
        </button>
      </div>
      <ul class="space-y-1">
        <For each={relays()}>
          {(relay: Relay) => (
            <li class="flex justify-between items-center border-b pb-1">
              <span class="break-all">{relay.inboxUrl}</span>
              <button
                type="button"
                class="text-sm text-red-500"
                onClick={() => onDelete(relay.id)}
              >
                削除
              </button>
            </li>
          )}
        </For>
      </ul>
    </div>
  );
};

export default RelaySettings;
