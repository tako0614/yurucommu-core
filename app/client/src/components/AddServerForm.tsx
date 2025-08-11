import { createSignal, Show } from "solid-js";
import { Modal, Input, Button } from "./ui";

interface AddServerFormProps {
  onAdd: (url: string, password: string) => Promise<void>;
  onClose: () => void;
}

export function AddServerForm(props: AddServerFormProps) {
  const [url, setUrl] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [error, setError] = createSignal("");
  const [isLoading, setIsLoading] = createSignal(false);

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    setError("");
    if (!url()) {
      setError("サーバーURLを入力してください");
      return;
    }
    if (!password()) {
      setError("パスワードを入力してください");
      return;
    }
    setIsLoading(true);
    await props.onAdd(url().trim(), password());
    setIsLoading(false);
    setUrl("");
    setPassword("");
  };

  return (
    // 共通のモーダルとフォームUIを使用してアクセシビリティと一貫性を向上
    <Modal open={true} onClose={props.onClose} title="サーバー追加">
      <form onSubmit={handleSubmit} class="space-y-5">
        <Input
          id="addServerUrl"
          type="text"
          label="サーバーURL"
          placeholder="http://example.com"
          value={url()}
          onInput={(e) => setUrl(e.currentTarget.value)}
          disabled={isLoading()}
          required
        />
        <Input
          id="addServerPassword"
          type="password"
          label="パスワード"
          placeholder="パスワード"
          value={password()}
          onInput={(e) => setPassword(e.currentTarget.value)}
          disabled={isLoading()}
          required
        />
        <Show when={error()}>
          <p class="text-rose-400 text-sm font-medium bg-rose-900/30 p-3 rounded-md">
            {error()}
          </p>
        </Show>
        <div class="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={props.onClose} disabled={isLoading()}>
            閉じる
          </Button>
          <Button type="submit" loading={isLoading()}>
            {isLoading() ? "追加中..." : "追加"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
