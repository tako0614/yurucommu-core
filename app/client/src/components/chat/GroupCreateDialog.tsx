import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onMount,
  Show,
} from "solid-js";
import { fetchFollowing } from "../microblog/api.ts";
import { useAtom } from "solid-jotai";
import { activeAccount } from "../../states/account.ts";
import { getDomain } from "../../utils/config.ts";

interface GroupCreateDialogProps {
  isOpen: boolean;
  mode: "create" | "invite";
  onClose: () => void;
  onCreate?: (name: string, members: string) => void;
  onInvite?: (members: string) => void;
  initialMembers?: string[]; // 事前に選択済みのメンバー
}

export function GroupCreateDialog(props: GroupCreateDialogProps) {
  const [account] = useAtom(activeAccount);
  const [name, setName] = createSignal("");
  const [searchTerm, setSearchTerm] = createSignal("");
  const [selectedMembers, setSelectedMembers] = createSignal<string[]>([]);
  const [memberInput, setMemberInput] = createSignal("");
  const [showFollowing, setShowFollowing] = createSignal(false);
  const [followingUsers, setFollowingUsers] = createSignal<
    Array<{ id: string; name: string; avatar?: string }>
  >([]);

  // フォロー中のユーザーを取得
  onMount(async () => {
    const user = account();
    if (user) {
      try {
        const following = await fetchFollowing(user.userName);
        const followingList = Array.isArray(following)
          ? following.map((f: {
            userName?: string;
            displayName?: string;
            domain?: string;
            avatar?: string;
            authorAvatar?: string;
          }) => ({
            id: (function () {
              if (f.userName && f.domain) return `${f.userName}@${f.domain}`;
              if (f.userName && !f.domain) return `${f.userName}@${getDomain()}`;
              return String(f);
            })(),
            name: f.displayName || f.userName || String(f),
            avatar: f.avatar || f.authorAvatar,
          }))
          : [];
        setFollowingUsers(followingList);
      } catch (error) {
        console.error("Failed to fetch following users:", error);
      }
    }
  });

  // 表示用のフォロー中ユーザーリスト（検索フィルタ適用）
  const filteredFollowing = createMemo(() => {
    const term = searchTerm().toLowerCase();
    return followingUsers().filter((user) =>
      user.name.toLowerCase().includes(term) ||
      user.id.toLowerCase().includes(term)
    );
  });

  const addMember = (userId: string) => {
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

    if (props.mode === "create" && selectedMembers().length < 1) {
      alert("最低1人のメンバーを追加してください");
      return;
    }

    if (props.mode === "create" && !groupName && selectedMembers().length > 1) {
      alert("グループ名を入力してください");
      return;
    }

    if (props.mode === "invite") {
      if (props.onInvite) props.onInvite(members);
    } else if (props.onCreate) {
      props.onCreate(groupName, members);
    }

    // リセット
    setName("");
    setSelectedMembers([]);
    setMemberInput("");
    setSearchTerm("");
  };

  const resetForm = () => {
    setName("");
    setSelectedMembers([]);
    setMemberInput("");
    setSearchTerm("");
    setShowFollowing(false);
  };

  createEffect(() => {
    if (props.isOpen) {
      setSelectedMembers(props.initialMembers ?? []);
    } else {
      resetForm();
    }
  });

  return (
    <Show when={props.isOpen}>
      <div class="fixed inset-0 z-50 flex items-center justify-center">
        {/* 背景オーバーレイ（ぼかし効果付き） */}
        <div
          class="absolute inset-0 bg-black bg-opacity-50 backdrop-blur-sm"
          onClick={props.onClose}
        />

        {/* ダイアログコンテンツ */}
        <div class="relative bg-[#2a2a2a] rounded-lg p-6 w-[90%] max-w-md mx-4 max-h-[80vh] overflow-hidden flex flex-col shadow-2xl">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-xl font-bold text-white">
              <Show when={props.mode === "create"} fallback="メンバー招待">
                ルーム作成
              </Show>
            </h2>
            <button
              type="button"
              onClick={props.onClose}
              class="text-gray-400 hover:text-white text-xl font-bold w-8 h-8 flex items-center justify-center"
            >
              ×
            </button>
          </div>

          <div class="flex-1 overflow-y-auto">
            <Show
              when={props.mode === "create" && selectedMembers().length > 1}
            >
              <div class="mb-4">
                <label class="block text-sm font-medium text-gray-300 mb-2">
                  グループ名
                </label>
                <input
                  type="text"
                  value={name()}
                  onInput={(e) => setName(e.currentTarget.value)}
                  placeholder="グループ名を入力..."
                  class="w-full px-3 py-2 bg-[#3a3a3a] border border-[#4a4a4a] rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
              </div>
            </Show>

            <div class="mb-4">
              <div class="flex items-center justify-between mb-2">
                <label class="block text-sm font-medium text-gray-300">
                  メンバーを追加
                </label>
                <div class="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowFollowing(false)}
                    class={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                      !showFollowing()
                        ? "bg-blue-600 text-white"
                        : "bg-[#3a3a3a] text-gray-400 hover:text-white"
                    }`}
                  >
                    手動入力
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowFollowing(true)}
                    class={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                      showFollowing()
                        ? "bg-blue-600 text-white"
                        : "bg-[#3a3a3a] text-gray-400 hover:text-white"
                    }`}
                  >
                    フォロー中
                  </button>
                </div>
              </div>

              <Show when={!showFollowing()}>
                <div class="flex gap-2">
                  <input
                    type="text"
                    value={memberInput()}
                    onInput={(e) => setMemberInput(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addMemberFromInput();
                      }
                    }}
                    placeholder="@username@domain.com"
                    class="flex-1 px-3 py-2 bg-[#3a3a3a] border border-[#4a4a4a] rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 text-sm"
                  />
                  <button
                    type="button"
                    onClick={addMemberFromInput}
                    disabled={!memberInput().trim()}
                    class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-sm font-medium"
                  >
                    追加
                  </button>
                </div>
              </Show>

              <Show when={showFollowing()}>
                <div class="space-y-2">
                  <input
                    type="text"
                    value={searchTerm()}
                    onInput={(e) => setSearchTerm(e.currentTarget.value)}
                    placeholder="フォロー中のユーザーを検索..."
                    class="w-full px-3 py-2 bg-[#3a3a3a] border border-[#4a4a4a] rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 text-sm"
                  />
                  <div class="max-h-40 overflow-y-auto space-y-1">
                    <For each={filteredFollowing()}>
                      {(user) => (
                        <div
                          class={`flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors ${
                            selectedMembers().includes(user.id)
                              ? "bg-blue-600 bg-opacity-20 border border-blue-500"
                              : "bg-[#3a3a3a] hover:bg-[#4a4a4a]"
                          }`}
                          onClick={() => addMember(user.id)}
                        >
                          <div class="w-8 h-8 bg-gray-600 rounded-full flex items-center justify-center text-sm">
                            <Show
                              when={user.avatar}
                              fallback={user.name.charAt(0).toUpperCase()}
                            >
                              <img
                                src={user.avatar}
                                class="w-8 h-8 rounded-full object-cover"
                                alt={user.name}
                              />
                            </Show>
                          </div>
                          <div class="flex-1 min-w-0">
                            <div class="text-white text-sm font-medium truncate">
                              {user.name}
                            </div>
                            <div class="text-gray-400 text-xs truncate">
                              {user.id}
                            </div>
                          </div>
                          <Show when={selectedMembers().includes(user.id)}>
                            <div class="w-5 h-5 bg-blue-600 rounded-full flex items-center justify-center">
                              <svg
                                class="w-3 h-3 text-white"
                                fill="currentColor"
                                viewBox="0 0 20 20"
                              >
                                <path
                                  fill-rule="evenodd"
                                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                  clip-rule="evenodd"
                                />
                              </svg>
                            </div>
                          </Show>
                        </div>
                      )}
                    </For>
                    <Show when={filteredFollowing().length === 0}>
                      <div class="text-center py-8 text-gray-500">
                        <Show
                          when={searchTerm()}
                          fallback="フォロー中のユーザーがいません"
                        >
                          検索結果がありません
                        </Show>
                      </div>
                    </Show>
                  </div>
                </div>
              </Show>
            </div>

            <Show when={selectedMembers().length > 0}>
              <div class="mb-4">
                <label class="block text-sm font-medium text-gray-300 mb-2">
                  選択中のメンバー ({selectedMembers().length}人)
                </label>
                <div class="flex flex-wrap gap-2">
                  <For each={selectedMembers()}>
                    {(member) => (
                      <div class="flex items-center gap-2 bg-blue-600 bg-opacity-20 border border-blue-500 text-blue-300 px-3 py-1 rounded-full text-sm">
                        <span>{member}</span>
                        <button
                          type="button"
                          onClick={() => removeMember(member)}
                          class="text-blue-300 hover:text-white ml-1 text-lg leading-none"
                        >
                          ×
                        </button>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            </Show>
          </div>

          <div class="flex justify-end gap-3 pt-4 border-t border-[#4a4a4a]">
            <button
              type="button"
              onClick={props.onClose}
              class="px-4 py-2 text-gray-400 hover:text-white transition-colors"
            >
              キャンセル
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={selectedMembers().length === 0}
              class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed font-medium"
            >
              <Show when={props.mode === "create"}>
                グループ作成
              </Show>
              <Show when={props.mode === "invite"}>
                招待
              </Show>
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}
