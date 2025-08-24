import { createSignal, For, onMount } from "solid-js";
import { apiFetch, getDomain } from "../../utils/config.ts";
import { useAtom } from "solid-jotai";
import { activeAccount } from "../../states/account.ts";

interface GroupOptions {
  membershipPolicies: string[];
  visibilities: string[];
}

export function GroupSettingsForm() {
  const [account] = useAtom(activeAccount);
  const [options, setOptions] = createSignal<GroupOptions>({
    membershipPolicies: [],
    visibilities: [],
  });
  const [groupName, setGroupName] = createSignal("");
  const [displayName, setDisplayName] = createSignal("");
  const [summary, setSummary] = createSignal("");
  const [membershipPolicy, setMembershipPolicy] = createSignal("");
  const [visibility, setVisibility] = createSignal("");
  const [allowInvites, setAllowInvites] = createSignal(true);
  const [message, setMessage] = createSignal("");

  onMount(async () => {
    try {
      const res = await apiFetch("/api/config");
      if (res.ok) {
        const data = await res.json();
        if (data.groupConfig) setOptions(data.groupConfig);
      }
    } catch {
      /* ignore */
    }
  });

  const createGroup = async () => {
    setMessage("");
    try {
      const handle = account() ? `${account()!.userName}@${getDomain()}` : "";
      const res = await apiFetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groupName: groupName(),
          displayName: displayName(),
          summary: summary() || undefined,
          membershipPolicy: membershipPolicy() || undefined,
          visibility: visibility() || undefined,
          allowInvites: allowInvites(),
          member: handle,
        }),
      });
      setMessage(res.ok ? "作成しました" : "作成に失敗しました");
    } catch {
      setMessage("作成に失敗しました");
    }
  };

  const updateGroup = async () => {
    setMessage("");
    try {
      const res = await apiFetch(`/api/groups/${groupName()}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: displayName() || undefined,
          summary: summary() || undefined,
          membershipPolicy: membershipPolicy() || undefined,
          visibility: visibility() || undefined,
          allowInvites: allowInvites(),
        }),
      });
      setMessage(res.ok ? "更新しました" : "更新に失敗しました");
    } catch {
      setMessage("更新に失敗しました");
    }
  };

  return (
    <div class="space-y-4">
      <div>
        <label class="block mb-1">グループ名</label>
        <input
          type="text"
          class="w-full p-2 rounded bg-[#1e1e1e] text-white border border-[#333]"
          value={groupName()}
          onInput={(e) => setGroupName(e.currentTarget.value)}
          placeholder="group"
        />
      </div>
      <div>
        <label class="block mb-1">表示名</label>
        <input
          type="text"
          class="w-full p-2 rounded bg-[#1e1e1e] text-white border border-[#333]"
          value={displayName()}
          onInput={(e) => setDisplayName(e.currentTarget.value)}
        />
      </div>
      <div>
        <label class="block mb-1">概要</label>
        <textarea
          class="w-full p-2 rounded bg-[#1e1e1e] text-white border border-[#333]"
          value={summary()}
          onInput={(e) => setSummary(e.currentTarget.value)}
        />
      </div>
      <div>
        <label class="block mb-1">承認方式</label>
        <select
          class="w-full p-2 rounded bg-[#1e1e1e] text-white border border-[#333]"
          value={membershipPolicy()}
          onChange={(e) => setMembershipPolicy(e.currentTarget.value)}
        >
          <option value="">未設定</option>
          <For each={options().membershipPolicies}>
            {(opt) => <option value={opt}>{opt}</option>}
          </For>
        </select>
      </div>
      <div>
        <label class="block mb-1">公開範囲</label>
        <select
          class="w-full p-2 rounded bg-[#1e1e1e] text-white border border-[#333]"
          value={visibility()}
          onChange={(e) => setVisibility(e.currentTarget.value)}
        >
          <option value="">未設定</option>
          <For each={options().visibilities}>
            {(opt) => <option value={opt}>{opt}</option>}
          </For>
        </select>
      </div>
      <div class="flex items-center gap-2">
        <input
          type="checkbox"
          checked={allowInvites()}
          onChange={(e) => setAllowInvites(e.currentTarget.checked)}
        />
        <span>メンバーによる招待を許可</span>
      </div>
      <div class="flex gap-2">
        <button
          type="button"
          class="px-4 py-2 bg-blue-600 text-white rounded"
          onClick={createGroup}
        >
          作成
        </button>
        <button
          type="button"
          class="px-4 py-2 bg-green-600 text-white rounded"
          onClick={updateGroup}
        >
          更新
        </button>
      </div>
      <div class="text-sm text-gray-400">{message()}</div>
    </div>
  );
}
