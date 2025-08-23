import { createSignal, Show } from "solid-js";
import { useAtom } from "solid-jotai";
import { loginState } from "../../states/session.ts";
import { apiFetch } from "../../utils/config.ts";

export function GroupAdmin() {
  const [isLoggedIn] = useAtom(loginState);
  const [name, setName] = createSignal("");
  const [displayName, setDisplayName] = createSignal("");
  const [summary, setSummary] = createSignal("");
  const [icon, setIcon] = createSignal("");
  const [image, setImage] = createSignal("");
  const [message, setMessage] = createSignal("");
  const [inviteActor, setInviteActor] = createSignal("");
  const [inviteMsg, setInviteMsg] = createSignal("");

  const loadGroup = async () => {
    setMessage("");
    try {
      const res = await apiFetch(`/groups/${name()}`);
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      setDisplayName(String(data.name ?? ""));
      setSummary(String(data.summary ?? ""));
      setIcon(typeof data.icon === "string" ? data.icon : "");
      setImage(typeof data.image === "string" ? data.image : "");
    } catch (_err) {
      setMessage("読み込みに失敗しました");
    }
  };

  const saveGroup = async () => {
    setMessage("");
    try {
      await apiFetch(`/api/groups/${name()}/actor`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: displayName(),
          summary: summary(),
          icon: icon(),
          image: image(),
        }),
      });
      setMessage("保存しました");
    } catch (_err) {
      setMessage("保存に失敗しました");
    }
  };

  const sendInvite = async () => {
    setInviteMsg("");
    try {
      await apiFetch(`/api/groups/${name()}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actor: inviteActor() }),
      });
      setInviteMsg("送信しました");
    } catch (_err) {
      setInviteMsg("送信に失敗しました");
    }
  };

  return (
    <Show
      when={isLoggedIn()}
      fallback={<p class="p-4">管理者ログインが必要です</p>}
    >
      <div class="space-y-4 p-4 max-w-lg mx-auto">
        <div>
          <label class="block mb-1">グループ名</label>
          <input
            class="w-full bg-gray-700 text-white p-2 rounded"
            value={name()}
            onInput={(e) => setName(e.currentTarget.value)}
          />
        </div>
        <button
          type="button"
          class="bg-blue-600 text-white px-4 py-2 rounded"
          onClick={loadGroup}
        >
          読み込み
        </button>
        <div>
          <label class="block mb-1">表示名</label>
          <input
            class="w-full bg-gray-700 text-white p-2 rounded"
            value={displayName()}
            onInput={(e) => setDisplayName(e.currentTarget.value)}
          />
        </div>
        <div>
          <label class="block mb-1">プロフィール</label>
          <textarea
            class="w-full bg-gray-700 text-white p-2 rounded"
            value={summary()}
            onInput={(e) => setSummary(e.currentTarget.value)}
          />
        </div>
        <div>
          <label class="block mb-1">アイコンURL</label>
          <input
            class="w-full bg-gray-700 text-white p-2 rounded"
            value={icon()}
            onInput={(e) => setIcon(e.currentTarget.value)}
          />
        </div>
        <div>
          <label class="block mb-1">ヘッダーURL</label>
          <input
            class="w-full bg-gray-700 text-white p-2 rounded"
            value={image()}
            onInput={(e) => setImage(e.currentTarget.value)}
          />
        </div>
        <button
          type="button"
          class="bg-green-600 text-white px-4 py-2 rounded"
          onClick={saveGroup}
        >
          保存
        </button>
        <p>{message()}</p>
        <hr class="my-4" />
        <div>
          <label class="block mb-1">招待先 Actor</label>
          <input
            class="w-full bg-gray-700 text-white p-2 rounded"
            value={inviteActor()}
            onInput={(e) => setInviteActor(e.currentTarget.value)}
          />
        </div>
        <button
          type="button"
          class="bg-purple-600 text-white px-4 py-2 rounded"
          onClick={sendInvite}
        >
          招待送信
        </button>
        <p>{inviteMsg()}</p>
      </div>
    </Show>
  );
}

export default GroupAdmin;
