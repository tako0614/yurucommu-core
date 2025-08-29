import { createSignal, Show, createEffect, For, createMemo } from "solid-js";
import { fetchFollowing } from "../microblog/api.ts";
import { useAtom } from "solid-jotai";
import { activeAccount } from "../../states/account.ts";
import { followingListMap, setFollowingList } from "../../states/account.ts";
import { getDomain } from "../../utils/config.ts";
import { Button } from "../ui/index.ts";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (handle: string) => void;
}

export function ChatCreateDMDialog(props: Props) {
  const [account] = useAtom(activeAccount);
  const [handle, setHandle] = createSignal("");
  const [searchTerm, setSearchTerm] = createSignal("");
  const [followingUsers, setFollowingUsers] = createSignal<Array<{ id: string; name: string; avatar?: string }>>([]);
  const [followingMap] = useAtom(followingListMap);
  const [, saveFollowingGlobal] = useAtom(setFollowingList);

  const selfHandle = createMemo(() => {
    const acc = account();
    return acc ? `${acc.userName}@${getDomain()}` : null;
  });

  interface RawFollowingUser {
    userName?: string;
    domain?: string;
    displayName?: string;
    avatar?: string;
    authorAvatar?: string;
  }

  const toDisplayList = (list: unknown[]) => (
    Array.isArray(list)
      ? list.map((f: unknown) => {
        const user = f as RawFollowingUser | string;
        return {
          id: (function () {
            if (typeof user === "object" && user && "userName" in user) {
              if (user.userName && user.domain) return `${user.userName}@${user.domain}`;
              if (user.userName && !user.domain) return `${user.userName}@${getDomain()}`;
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
      saveFollowingGlobal({ accountId, list: Array.isArray(list) ? list : [] });
    } catch (error) {
      console.error("Failed to fetch following users:", error);
    }
  });

  createEffect(() => {
    const acc = account();
    if (!acc) return;
    const cached = followingMap()[acc.id];
    if (cached) setFollowingUsers(toDisplayList(cached));
  });

  const filteredFollowing = createMemo(() => {
    const term = searchTerm().toLowerCase();
    const me = selfHandle();
    return followingUsers()
      .filter((u) => !me || u.id !== me)
      .filter((user) => user.name.toLowerCase().includes(term) || user.id.toLowerCase().includes(term));
  });

  const submit = () => {
    const h = handle().trim();
    if (!h) return;
    const normalized = h.includes("@") || h.startsWith("http") ? h : `${h}@${getDomain()}`;
    props.onCreate(normalized);
    props.onClose();
  };

  const pickUser = (id: string) => {
    setHandle(id);
  };

  createEffect(() => {
    if (props.isOpen) setHandle("");
  });

  return (
    <Show when={props.isOpen}>
      <div class="fixed inset-0 z-50 flex items-center justify-center">
        <div class="absolute inset-0 bg-black/40 z-40" onClick={props.onClose} />
  <div class="relative w-full h-full bg-[#1e1e1e] p-4 border border-[#333] z-50 rounded-none sm:rounded-lg sm:w-[min(560px,95%)] sm:h-auto">
          <h3 class="text-lg font-semibold text-white mb-3">新しい DM を作成</h3>

          <div class="mb-3">
            <label class="text-sm text-gray-300">相手のハンドル（例: alice@example.com）</label>
            <input
              type="text"
              class="w-full mt-1 p-2 rounded bg-[#1e1e1e] text-white border border-[#333]"
              value={handle()}
              onInput={(e) => setHandle(e.currentTarget.value)}
              placeholder="alice@example.com または alice"
            />
          </div>

          <div class="mb-3">
            <label class="block text-sm font-medium text-gray-300">候補（クリックで入力欄に反映）</label>
            <input
              type="text"
              value={searchTerm()}
              onInput={(e) => setSearchTerm(e.currentTarget.value)}
              placeholder="フォロー中を検索..."
              class="w-full px-3 py-2 bg-[#3a3a3a] border border-[#4a4a4a] rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 text-sm mt-2"
            />
            <div class="max-h-48 overflow-y-auto mt-2">
              <For each={filteredFollowing()}>
                {(user) => (
                  <div class="flex items-center gap-3 p-2 rounded-lg cursor-pointer hover:bg-[#4a4a4a]" onClick={() => pickUser(user.id)}>
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
                <div class="text-center py-6 text-gray-500">{searchTerm() ? "検索結果がありません" : "フォロー中のユーザーがいません"}</div>
              </Show>
            </div>
          </div>

          <div class="flex justify-end gap-2">
            <Button size="sm" onClick={props.onClose}>キャンセル</Button>
            <Button size="sm" onClick={submit}>作成</Button>
          </div>
        </div>
      </div>
    </Show>
  );
}

export default ChatCreateDMDialog;
