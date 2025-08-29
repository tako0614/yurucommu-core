import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { fetchFollowing } from "../microblog/api.ts";
import { useAtom } from "solid-jotai";
import { activeAccount } from "../../states/account.ts";
import { followingListMap, setFollowingList } from "../../states/account.ts";
import { getDomain } from "../../utils/config.ts";

interface GroupCreateDialogProps {
  isOpen: boolean;
  mode: "create" | "invite";
  onClose: () => void;
  // onCreate/onInvite now receive an optional icon data URL as 3rd argument
  onCreate?: (name: string, members: string, icon?: string | null) => void;
  onInvite?: (members: string, icon?: string | null) => void;
  initialMembers?: string[]; // 事前に選択済みのメンバー
}

export function GroupCreateDialog(props: GroupCreateDialogProps) {
  const [account] = useAtom(activeAccount);
  const [name, setName] = createSignal("");
  const [searchTerm, setSearchTerm] = createSignal("");
  const [selectedMembers, setSelectedMembers] = createSignal<string[]>([]);
  const [memberInput, setMemberInput] = createSignal("");
  const [followingUsers, setFollowingUsers] = createSignal<
    Array<{ id: string; name: string; avatar?: string }>
  >([]);
  const [iconFile, setIconFile] = createSignal<File | null>(null);
  const [iconPreview, setIconPreview] = createSignal<string | null>(null);
  const [followingMap] = useAtom(followingListMap);
  const [, saveFollowingGlobal] = useAtom(setFollowingList);
  // 自身のハンドル（@user@domain）を求める
  const selfHandle = createMemo(() => {
    const acc = account();
    return acc ? `${acc.userName}@${getDomain()}` : null;
  });

  // フォロイングユーザーのためのインターフェース
  interface FollowingUser {
    userName?: string;
    domain?: string;
    displayName?: string;
    avatar?: string;
    authorAvatar?: string;
  }

  // 表示用に整形する補助
  const toDisplayList = (list: unknown[]) => (
    Array.isArray(list)
      ? list.map((f: unknown) => {
        const user = f as FollowingUser | string;
        return {
          id: (function () {
            if (typeof user === "object" && user && "userName" in user) {
              if (
                user.userName && user.domain
              ) return `${user.userName}@${user.domain}`;
              if (
                user.userName && !user.domain
              ) return `${user.userName}@${getDomain()}`;
            }
            return String(user);
          })(),
          name: typeof user === "object" && user && "displayName" in user
            ? (user.displayName || user.userName || String(user))
            : String(user),
          avatar: typeof user === "object" && user && "avatar" in user
            ? (user.avatar || user.authorAvatar)
            : undefined,
        };
      })
      : []
  );

  // iconFile がセットされたら Data URL に変換してプレビューに使う
  createEffect(() => {
    const f = iconFile();
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string | ArrayBuffer | null;
      if (typeof result === "string") setIconPreview(result);
    };
    reader.readAsDataURL(f);
  });

  // ダイアログが開いたとき、またはアカウントが確定したときにフォロー中ユーザーを用意
  createEffect(async () => {
    const acc = account();
    if (!props.isOpen || !acc) return;

    const accountId = acc.id;
    const cached = followingMap()[accountId];
    if (cached) {
      setFollowingUsers(toDisplayList(cached));
      return;
    }

    try {
      const list = await fetchFollowing(acc.userName);
      setFollowingUsers(toDisplayList(list));
      // グローバルにも保存（次回以降の画面で共有）
      saveFollowingGlobal({ accountId, list: Array.isArray(list) ? list : [] });
    } catch (error) {
      console.error("Failed to fetch following users:", error);
    }
  });

  // グローバルキャッシュが更新された場合にも同期
  createEffect(() => {
    const acc = account();
    if (!acc) return;
    const cached = followingMap()[acc.id];
    if (cached) setFollowingUsers(toDisplayList(cached));
  });

  // 表示用のフォロー中ユーザーリスト（検索フィルタ適用）
  const filteredFollowing = createMemo(() => {
    const term = searchTerm().toLowerCase();
    const me = selfHandle();
    return followingUsers()
      // 自分自身は候補から除外
      .filter((u) => !me || u.id !== me)
      .filter((user) =>
        user.name.toLowerCase().includes(term) ||
        user.id.toLowerCase().includes(term)
      );
  });

  const addMember = (userId: string) => {
    // 自分自身は追加しない
    if (selfHandle() && userId === selfHandle()) {
      globalThis.dispatchEvent(
        new CustomEvent("app:toast", {
          detail: {
            type: "warning",
            title: "追加できません",
            description: "自分自身はメンバーに追加できません",
          },
        }),
      );
      return;
    }
    if (!selectedMembers().includes(userId)) {
      setSelectedMembers([...selectedMembers(), userId]);
      setMemberInput("");
      setSearchTerm("");
    }
  };

  const addMemberFromInput = () => {
    let input = memberInput().trim();
    if (!input) return;
    if (input.startsWith("@")) input = input.slice(1);
    // ローカル省略時は local domain を補う
    if (!input.includes("@")) input = `${input}@${getDomain()}`;
    // 自分自身は追加しない
    if (selfHandle() && input === selfHandle()) {
      globalThis.dispatchEvent(
        new CustomEvent("app:toast", {
          detail: {
            type: "warning",
            title: "追加できません",
            description: "自分自身はメンバーに追加できません",
          },
        }),
      );
      return;
    }
    if (!selectedMembers().includes(input)) {
      setSelectedMembers([...selectedMembers(), input]);
      setMemberInput("");
    }
  };

  const removeMember = (userId: string) => {
    setSelectedMembers(selectedMembers().filter((id) => id !== userId));
  };

  const handleSubmit = () => {
    const groupName = name().trim();
    const membersArr = [...selectedMembers()];
    const user = account();
    if (user) {
      const me = `${user.userName}@${getDomain()}`;
      if (!membersArr.includes(me)) membersArr.push(me);
    }
    const members = membersArr.join(",");

  // Allow creating a group even if no members or name specified.
  // The server-side will accept optional members; the client still adds the current user to membersArr below.

    const icon = iconPreview();
    if (props.mode === "invite") {
      if (props.onInvite) props.onInvite(members, icon ?? null);
    } else if (props.onCreate) {
      props.onCreate(groupName, members, icon ?? null);
    }

    // リセット
    setName("");
    setSelectedMembers([]);
    setMemberInput("");
    setSearchTerm("");
  };

  const onIconSelect = (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    const f = input.files[0];
    setIconFile(f);
  };

  const removeIcon = () => {
    setIconFile(null);
    setIconPreview(null);
  };

  // 親しみやすいデフォルト名を生成する
  const defaultName = createMemo(() => {
    const sel = selectedMembers();
    // メンバー名からローカルパートを取り出す
    const local = (id: string) => {
      const part = id.split("@")[0] || id;
      // ドメイン込みの長い文字列は短縮
      return part.length > 12 ? part.slice(0, 12) + '…' : part;
    };

    if (sel.length === 0) {
      // ランダム候補から一つ選ぶ（固定だと退屈なので時間を元に振り分け）
      const candidates = ["交流ルーム", "おしゃべり広場", "まったり会", "チーム", "雑談ルーム"];
      const idx = Math.floor((Date.now() / 1000) % candidates.length);
      return candidates[idx];
    }

    if (sel.length === 1) {
      return `${local(sel[0])}さんと私の会話`;
    }

    // 2人以上
    const names = sel.slice(0, 2).map(local);
    return `${names.join('・')}のグループ`;
  });

  const resetForm = () => {
    setName("");
    setSelectedMembers([]);
    setMemberInput("");
    setSearchTerm("");
  };

  createEffect(() => {
    if (props.isOpen) {
      const me = selfHandle();
      // 初期選択に自分が含まれる場合は除外
      const init = (props.initialMembers ?? []).filter((id) =>
        !me || id !== me
      );
      setSelectedMembers(init);
    } else {
      resetForm();
    }
  });

  return (
    <Show when={props.isOpen}>
      <div class="fixed inset-0 z-50 flex items-center justify-center">
        {/* 背景オーバーレイ（薄くして背景が見えるように） */}
        <div class="absolute inset-0 bg-black/40 z-40" onClick={props.onClose} />

        {/* ダイアログコンテンツ（DM と同じ見た目に統一） */}
  <div class="relative w-full h-full bg-[#1e1e1e] p-4 border border-[#333] z-50 rounded-none sm:rounded-lg sm:w-[min(560px,95%)] sm:h-auto">
          <h3 class="text-lg font-semibold text-white mb-3">{props.mode === 'create' ? '新しいグループを作成' : 'メンバーを招待'}</h3>

          {/* アイコン選択とグループ名 */}
          <div class="mb-3 flex flex-col sm:flex-row items-start gap-4">
            <div class="flex-shrink-0">
              <div class="w-20 h-20 rounded-lg bg-[#2a2a2a] flex items-center justify-center overflow-hidden border border-[#333]">
                <Show when={iconPreview()} fallback={<div class="text-gray-300 text-3xl">{(name() || "G").charAt(0).toUpperCase()}</div>}>
                  <img src={iconPreview()!} alt="group icon" class="w-full h-full object-cover" />
                </Show>
              </div>
              <div class="flex gap-2 mt-2">
                <label class="px-3 py-1 text-sm bg-[#111827] text-white rounded cursor-pointer border border-[#333]">
                  画像を選択
                  <input type="file" accept="image/*" class="hidden" onInput={onIconSelect} />
                </label>
                <button type="button" class="px-3 py-1 text-sm text-gray-300 border border-[#333] rounded" onClick={removeIcon} disabled={!iconPreview()}>削除</button>
              </div>
            </div>

            <div class="flex-1">
              <label class="text-sm text-gray-300">グループ名</label>
              <input
                type="text"
                class="w-full mt-1 p-2 rounded bg-[#1e1e1e] text-white border border-[#333]"
                value={name()}
                onInput={(e) => setName(e.currentTarget.value)}
                placeholder="グループ名 (例: 開発チーム、友人会)"
                maxlength={50}
              />
              <div class="text-xs text-gray-500 mt-1 flex items-center justify-between">
                <div>{name().length}/50</div>
                <div class="text-right">
                  <div class="text-xs text-gray-400">提案: <span class="text-gray-200">{defaultName()}</span></div>
                  <button type="button" class="text-xs text-blue-400 hover:text-blue-200 mt-1" onClick={() => setName(defaultName())}>提案を適用</button>
                </div>
              </div>
            </div>
          </div>

          <div class="mb-3">
            <label class="text-sm text-gray-300">メンバー（改行・カンマで複数）</label>
            <div class="flex gap-2 mt-2">
              <input
                type="text"
                class="flex-1 p-2 rounded bg-[#1e1e1e] text-white border border-[#333]"
                value={memberInput()}
                onInput={(e) => setMemberInput(e.currentTarget.value)}
                placeholder="alice@example.com または alice"
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addMemberFromInput(); } }}
              />
              <button type="button" class="px-4 py-2 bg-blue-600 text-white rounded" onClick={addMemberFromInput} disabled={!memberInput().trim()}>追加</button>
            </div>
          </div>

          <div class="mb-3">
            <label class="text-sm text-gray-300">フォロー中（クリックで追加）</label>
            <input
              type="text"
              value={searchTerm()}
              onInput={(e) => setSearchTerm(e.currentTarget.value)}
              placeholder="フォロー中のユーザーを検索..."
              class="w-full mt-1 p-2 rounded bg-[#1e1e1e] text-white border border-[#333]"
            />
            <div class="max-h-40 overflow-y-auto mt-2 space-y-1">
              <For each={filteredFollowing()}>
                {(user) => (
                  <div class={`flex items-center gap-3 p-2 rounded-lg cursor-pointer ${selectedMembers().includes(user.id) ? 'bg-blue-600 bg-opacity-20 border border-blue-500' : 'bg-[#1e1e1e] hover:bg-[#2a2a2a]'}`} onClick={() => addMember(user.id)}>
                    <div class="w-8 h-8 bg-gray-600 rounded-full flex items-center justify-center text-sm">
                      <Show when={user.avatar} fallback={user.name.charAt(0).toUpperCase()}>
                        <img src={user.avatar} class="w-8 h-8 rounded-full object-cover" alt={user.name} />
                      </Show>
                    </div>
                    <div class="flex-1 min-w-0">
                      <div class="text-white text-sm font-medium truncate">{user.name}</div>
                      <div class="text-gray-400 text-xs truncate">{user.id}</div>
                    </div>
                  </div>
                )}
              </For>
              <Show when={filteredFollowing().length === 0}>
                <div class="text-center py-6 text-gray-500">{searchTerm() ? '検索結果がありません' : 'フォロー中のユーザーがいません'}</div>
              </Show>
            </div>
          </div>

          <Show when={selectedMembers().length > 0}>
            <div class="mb-3">
              <label class="text-sm text-gray-300 mb-2">選択中のメンバー ({selectedMembers().length}人)</label>
              <div class="flex flex-wrap gap-2">
                <For each={selectedMembers()}>{(member) => (
                  <div class="flex items-center gap-2 bg-blue-600 bg-opacity-20 border border-blue-500 text-blue-300 px-3 py-1 rounded-full text-sm">
                    <span>{member}</span>
                    <button type="button" onClick={() => removeMember(member)} class="text-blue-300 hover:text-white ml-1 text-lg leading-none">×</button>
                  </div>
                )}</For>
              </div>
            </div>
          </Show>

          <div class="flex justify-end gap-2 mt-4">
            <button type="button" onClick={props.onClose} class="px-4 py-2 text-gray-400 hover:text-white">キャンセル</button>
            <button type="button" onClick={handleSubmit} disabled={selectedMembers().length === 0} class="px-4 py-2 bg-blue-600 text-white rounded">{props.mode === 'create' ? 'グループ作成' : '招待'}</button>
          </div>
        </div>
      </div>
    </Show>
  );
}
