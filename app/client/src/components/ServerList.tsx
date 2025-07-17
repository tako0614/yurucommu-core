import { createSignal, For, Show as _Show } from "solid-js";

interface ServerListProps {
  servers: { url: string; password: string }[];
  onSelect: (url: string, password: string) => void;
  onAdd: () => void;
}

export function ServerList(props: ServerListProps) {
  const [_passwords, _setPasswords] = createSignal<{ [key: string]: string }>(
    {},
  );

  const _handlePasswordChange = (server: string, value: string) => {
    _setPasswords((prev) => ({ ...prev, [server]: value }));
  };

  return (
    <div class="flex flex-col gap-4">
      <For each={props.servers}>
        {(s) => (
          <div class="bg-gray-800 border border-gray-700 rounded-xl shadow p-4 flex flex-col hover:bg-gray-700 transition">
            <div class="font-bold text-lg text-white mb-2">{s.url}</div>
            <button
              type="button"
              class="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 self-end"
              onClick={() => props.onSelect(s.url, s.password)}
            >
              ログイン
            </button>
          </div>
        )}
      </For>
      <button
        type="button"
        class="bg-green-600 text-white px-6 py-3 rounded-xl shadow hover:bg-green-700 font-semibold mt-4"
        onClick={props.onAdd}
      >
        add server
      </button>
    </div>
  );
}
