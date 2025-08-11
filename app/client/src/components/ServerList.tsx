import { createSignal, For, Show as _Show } from "solid-js";
import { Card, Button } from "./ui";

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
          <Card title={s.url} class="hover:bg-[#242424] transition-colors">
            <div class="flex justify-end">
              <Button type="button" onClick={() => props.onSelect(s.url, s.password)}>
                ログイン
              </Button>
            </div>
          </Card>
        )}
      </For>
      <div class="mt-2">
        <Button type="button" onClick={props.onAdd} size="lg">
          サーバーを追加
        </Button>
      </div>
    </div>
  );
}
