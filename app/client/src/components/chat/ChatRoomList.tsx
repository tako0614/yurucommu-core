import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onMount,
  Show,
} from "solid-js";
import { useAtom } from "solid-jotai";
import { GoogleAd } from "../GoogleAd.tsx";
import { isUrl } from "../../utils/url.ts";
import type { Room } from "./types.ts";
import { isFriendRoom, isGroupRoom } from "./types.ts";
import { FriendList } from "./FriendList.tsx";
import { FriendRoomList } from "./FriendRoomList.tsx";
import { Button, EmptyState, Input, Skeleton } from "../ui/index.ts";
// ローディング表示の点滅を抑えるための簡易ディレイ表示フック
// コンポーネント配下（createRoot/render配下）でのみ使うこと
import SwipeTabs from "../ui/SwipeTabs.tsx";
import { activeAccount } from "../../states/account.ts";
import { getDomain } from "../../utils/config.ts";

interface ChatRoomListProps {
  rooms: Room[];
  selectedRoom: string | null;
  onSelect: (id: string) => void;
  showAds: boolean;
  onCreateRoom: () => void;
  segment: "all" | "people" | "groups";
  onSegmentChange: (seg: "all" | "people" | "groups") => void;
  onCreateFriendRoom?: (friendId: string) => void;
}

export function ChatRoomList(props: ChatRoomListProps) {
  const useDelayedVisibility = (
    visible: () => boolean,
    delay = 250,
    min = 300,
  ) => {
    const [shown, setShown] = createSignal(false);
    let delayTimer: number | undefined;
    let minTimer: number | undefined;
    let shownAt = 0;

    const clearTimers = () => {
      if (delayTimer) clearTimeout(delayTimer);
      if (minTimer) clearTimeout(minTimer);
      delayTimer = undefined;
      minTimer = undefined;
    };

    createEffect(() => {
      const v = visible();
      if (v) {
        if (!shown()) {
          clearTimers();
          delayTimer = setTimeout(() => {
            setShown(true);
            shownAt = Date.now();
          }, delay) as unknown as number;
        }
      } else {
        if (shown()) {
          const elapsed = Date.now() - shownAt;
          const rest = Math.max(0, min - elapsed);
          clearTimers();
          minTimer = setTimeout(() => setShown(false), rest) as unknown as number;
        } else {
          clearTimers();
          setShown(false);
        }
      }
    });

    onMount(() => {
      // マウント時にクリア状態を保証
      clearTimers();
    });

    return shown;
  };
  const [query, setQuery] = createSignal("");
  const [selectedFriend, setSelectedFriend] = createSignal<string | null>(null);
  const [account] = useAtom(activeAccount);
  // リストが空のときだけ、遅延してスケルトンを表示する（点滅防止）
  const showAllSkeleton = useDelayedVisibility(
    () => getFilteredRoomsFor("all").length === 0 && query().trim() === "",
    250,
    250,
  );
  const showGroupSkeleton = useDelayedVisibility(
    () => getFilteredRoomsFor("groups").length === 0 && query().trim() === "",
    250,
    250,
  );

  // ローカルストレージに最後のセグメントを保存/復元
  onMount(() => {
    const saved = globalThis.localStorage.getItem("chat.seg");
    if (saved === "all" || saved === "people" || saved === "groups") {
      if (saved !== props.segment) props.onSegmentChange(saved);
    }
  });
  createEffect(() => {
    globalThis.localStorage.setItem("chat.seg", props.segment);
  });

  // 1対1（未命名）トークの表示名を補正（自分の名前で表示されないように）
  // かつ、招待中で自分しか居ないグループはプレースホルダーを表示
  const displayNameFor = (room: Room): string => {
    // 明示的な displayName があれば最優先
    if (room.displayName && room.displayName.trim() !== "") return room.displayName;
    const me = account();
    if (!me) return room.name;
    if (room.type === "memo") return room.name;
    const selfHandle = `${me.userName}@${getDomain()}`;
    const members = room.members ?? [];
    // グループ（1:1以外）はそのまま（後段の補完で名前が入る想定）
    if (!isFriendRoom(room)) return room.name;
    if (isFriendRoom(room)) {
      const rawOther = room.members.find((m) => m !== selfHandle) ??
        room.members[0];
      const other = normalizeHandle(rawOther);
      if (
        room.name === "" || room.name === me.displayName ||
        room.name === me.userName || room.name === selfHandle
      ) {
        // 自分名や空のときは相手のハンドルを優先
        if (other && other !== selfHandle) return other;
        // 相手未確定なら pendingInvites から推測（接尾辞は付けない）
        const cand = (room.pendingInvites && room.pendingInvites[0]) || undefined;
        const guess = normalizeHandle(cand);
        if (guess && guess !== selfHandle) {
          const short = guess.includes("@") ? guess.split("@")[0] : guess;
          return short;
        }
        // 何も推定できない場合は空文字（表示は空のまま）
        return "";
      }
      return room.name;
    }
    return room.name;
  };

  const normalizeHandle = (id?: string): string | undefined => {
    if (!id) return undefined;
    if (id.startsWith("http")) {
      try {
        const u = new URL(id);
        const name = u.pathname.split("/").pop() || "";
        if (!name) return undefined;
        return `${name}@${u.hostname}`;
      } catch {
        return undefined;
      }
    }
    if (id.includes("@")) return id;
    // 裸の文字列（displayName/uuid等）はハンドルとみなさない
    return undefined;
  };

  const getFilteredRoomsFor = (seg: "all" | "people" | "groups") => {
    const q = query().toLowerCase().trim();
    let base = props.rooms;

    if (seg === "people") {
      base = base.filter((r) => isFriendRoom(r));
    } else if (seg === "groups") {
      const memoRoom = base.find((r) => r.type === "memo");
      const rest = base.filter((r) => isGroupRoom(r));
      base = memoRoom ? [memoRoom, ...rest] : rest;
    }

    let list = q
      ? base.filter((r) => {
        const dn = displayNameFor(r).toLowerCase();
        const nm = (r.name || "").toLowerCase();
        const lm = (r.lastMessage ?? "").toLowerCase();
        return dn.includes(q) || nm.includes(q) || lm.includes(q);
      })
      : base;

    list = list.filter((r, i, arr) =>
      arr.findIndex((x) => x.id === r.id) === i
    );

    const time = (d?: Date) => (d ? d.getTime() : 0);
    list.sort((a, b) => {
      const ua = a.unreadCount || 0;
      const ub = b.unreadCount || 0;
      if (ua !== ub) return ub - ua;
      const ta = time(a.lastMessageTime);
      const tb = time(b.lastMessageTime);
      if (ta !== tb) return tb - ta;
      return displayNameFor(a).localeCompare(displayNameFor(b));
    });
    return list;
  };

  const segUnread = createMemo(() => {
    const all = props.rooms.reduce((a, r) => a + (r.unreadCount || 0), 0);
    const people = props.rooms.filter((r) => isFriendRoom(r))
      .reduce((a, r) => a + (r.unreadCount || 0), 0);
    const groups = all - people;
    return { all, people, groups };
  });

  const getFriendName = (friendId: string) => {
    const room = props.rooms.find((r) =>
      isFriendRoom(r) && r.members.includes(friendId)
    );
    return room?.displayName || room?.name || friendId.split("@")[0] || friendId;
  };

  const changeSeg = (seg: "all" | "people" | "groups") => {
    if (seg === "people") {
      // 友だちタブの場合は友達リストにリセット
      setSelectedFriend(null);
    }
    if (seg !== props.segment) props.onSegmentChange(seg);
  };

  const onKeyDownTabs = (e: KeyboardEvent) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const order: ("all" | "people" | "groups")[] = [
        "all",
        "people",
        "groups",
      ];
      const idx = order.indexOf(props.segment);
      const next = e.key === "ArrowLeft"
        ? order[(idx + order.length - 1) % order.length]
        : order[(idx + 1) % order.length];
      changeSeg(next);
    }
  };

  // スライド式セグメントタブ（共通表示、配置のみ条件で入れ替え）
  const SegTabs = () => {
    const segs = ["all", "people", "groups"] as const;
    const idx = () => segs.indexOf(props.segment);
    return (
      <div
        class="relative mb-2 select-none"
        role="tablist"
        aria-label="トーク一覧のセグメント"
        onKeyDown={(e) => onKeyDownTabs(e as unknown as KeyboardEvent)}
      >
        <div class="relative grid grid-cols-3 bg-[#2b2b2b] rounded-lg p-1">
          <div
            class="absolute top-1 bottom-1 left-1 w-[calc(33.333%-4px)] rounded-md bg-[#4a4a4a] transition-transform duration-200 ease-out"
            style={{ transform: `translateX(calc(${idx()} * 100%))` }}
            aria-hidden="true"
          />
          {segs.map((seg) => (
            <button
              type="button"
              role="tab"
              id={`tab-${seg}`}
              aria-selected={props.segment === seg}
              aria-controls={`panel-${seg}`}
              class={`relative z-[1] h-8 text-sm rounded-md flex items-center justify-center text-center transition-colors ${
                props.segment === seg ? "text-white" : "text-gray-300"
              }`}
              onClick={() => changeSeg(seg)}
            >
              {seg === "all"
                ? "すべて"
                : seg === "people"
                ? "友だち"
                : "グループ"}
              <Show when={(segUnread()[seg] ?? 0) > 0}>
                <span class="ml-1 inline-block text-[10px] px-1.5 py-0.5 rounded-full bg-blue-600 text-white">
                  {segUnread()[seg]}
                </span>
              </Show>
            </button>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div class="min-h-screen p-3 pb-[76px] bg-[#1e1e1e] z-[3] w-screen lg:w-[360px] lg:flex-none lg:shrink-0 lg:border-r lg:border-[#333333]">
      <div class="flex items-center justify-between">
        <div class="text-[28px] mt-[6px] mx-[3px] mb-[8px] font-bold text-white">
          チャット
        </div>
        <div class="flex gap-2">
          <Button size="sm" onClick={props.onCreateRoom}>
            ＋ 新しいトーク
          </Button>
        </div>
      </div>
      <div class="block">
        <Input
          label="トークを検索"
          placeholder="トークを検索..."
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
        />
        <Show when={props.showAds}>
          <div class="my-2">
            <GoogleAd />
          </div>
        </Show>
      </div>
      {/* 検索の直下に常にセグメントを表示（順序が入れ替わらない） */}
      <SegTabs />

      {/* セグメントを横スワイプで切替（ドラッグ中は隣が見える） */}
      <SwipeTabs
        index={["all", "people", "groups"].indexOf(props.segment)}
        onIndexChange={(i) =>
          changeSeg((["all", "people", "groups"] as const)[i] ?? "all")}
      >
        {/* すべて */}
        <div class="my-[10px] overflow-y-auto overflow-x-hidden w-full pb-14 scrollbar">
          <ul
            id="panel-all"
            role="tabpanel"
            aria-labelledby="tab-all"
            class="w-full h-[calc(100vh-160px)] pb-[70px] scrollbar"
          >
            <Show when={showAllSkeleton()}>
              <li class="px-2 py-2">
                <RoomListSkeleton />
              </li>
            </Show>
            <Show
              when={!showAllSkeleton() &&
                getFilteredRoomsFor("all").length === 0}
            >
              <li class="px-2 py-2">
                <EmptyState
                  title="トークはありません"
                  description="新しいトークを作成して会話を始めましょう。"
                />
              </li>
            </Show>
            <For each={getFilteredRoomsFor("all")}>
              {(room) => (
                <li
                  class={`flex items-center cursor-pointer h-16 rounded-lg mb-2 w-full ${
                    props.selectedRoom === room.id
                      ? "bg-[#4a4a4a]"
                      : "hover:bg-[#3c3c3c]"
                  }`}
                  onClick={() => props.onSelect(room.id)}
                >
                  <div class="flex items-center w-full">
                    <span class="relative w-[40px] h-[40px] flex items-center justify-center">
                      {isUrl(room.avatar) ||
                          (typeof room.avatar === "string" &&
                            room.avatar.startsWith("data:image/"))
                        ? (
                          <img
                            src={room.avatar}
                            alt="avatar"
                            class="w-[40px] h-[40px] object-cover rounded-full"
                          />
                        )
                        : (
                          <span
                            class={`w-[40px] h-[40px] flex items-center justify-center rounded-full text-white text-[20px] ${
                              room.type === "memo"
                                ? "bg-green-600"
                                : "bg-[#444]"
                            }`}
                          >
                            {room.avatar ||
                              displayNameFor(room).charAt(0).toUpperCase()}
                          </span>
                        )}
                    </span>
                    <span class="pl-[10px] flex flex-col justify-center min-w-0 w-full">
                      <span class="text-[14px] text-white flex justify-between items-center w-full whitespace-nowrap overflow-hidden text-ellipsis">
                        <span class="font-bold flex-1">
                          {displayNameFor(room)}
                        </span>
                        <span
                          class="text-[10px] text-gray-500 ml-1 whitespace-nowrap"
                          style="text-align:right;"
                        >
                          {room.lastMessageTime
                            ? room.lastMessageTime.toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                            : ""}
                        </span>
                      </span>
                      <span class="text-[12px] text-[#aaaaaa] font-normal flex justify-between items-center">
                        <p class="truncate">{room.lastMessage}</p>
                      </span>
                    </span>
                  </div>
                </li>
              )}
            </For>
          </ul>
        </div>

        {/* 友だち */}
        <div class="my-[10px] overflow-y-auto overflow-x-hidden w-full pb-14 scrollbar">
          <Show when={selectedFriend()}>
            <FriendRoomList
              rooms={props.rooms}
              friendId={selectedFriend()!}
              friendName={getFriendName(selectedFriend()!)}
              selectedRoom={props.selectedRoom}
              onSelectRoom={props.onSelect}
              onBack={() => setSelectedFriend(null)}
              onCreateRoom={() => props.onCreateFriendRoom?.(selectedFriend()!)}
            />
          </Show>
          <Show when={!selectedFriend()}>
            <FriendList
              rooms={props.rooms}
              selectedFriend={selectedFriend()}
              query={query()}
              showSearch={false}
              onSelectFriend={(id) => setSelectedFriend(id)}
            />
          </Show>
        </div>

        {/* グループ */}
        <div class="my-[10px] overflow-y-auto overflow-x-hidden w-full pb-14 scrollbar">
          <ul
            id="panel-groups"
            role="tabpanel"
            aria-labelledby="tab-groups"
            class="w-full h-[calc(100vh-160px)] pb-[70px] scrollbar"
          >
            <Show when={showGroupSkeleton()}>
              <li class="px-2 py-2">
                <RoomListSkeleton />
              </li>
            </Show>
            <Show
              when={!showGroupSkeleton() &&
                getFilteredRoomsFor("groups").length === 0}
            >
              <li class="px-2 py-2">
                <EmptyState
                  title="グループはまだありません"
                  description="『グループ作成』から始めましょう。"
                />
              </li>
            </Show>
            <For each={getFilteredRoomsFor("groups")}>
              {(room) => (
                <li
                  class={`flex items-center cursor-pointer h-16 rounded-lg mb-2 w-full ${
                    props.selectedRoom === room.id
                      ? "bg-[#4a4a4a]"
                      : "hover:bg-[#3c3c3c]"
                  }`}
                  onClick={() => props.onSelect(room.id)}
                >
                  <div class="flex items-center w-full">
                    <span class="relative w-[40px] h-[40px] flex items-center justify-center">
                      {isUrl(room.avatar) ||
                          (typeof room.avatar === "string" &&
                            room.avatar.startsWith("data:image/"))
                        ? (
                          <img
                            src={room.avatar}
                            alt="avatar"
                            class="w-[40px] h-[40px] object-cover rounded-full"
                          />
                        )
                        : (
                          <span
                            class={`w-[40px] h-[40px] flex items-center justify-center rounded-full text-white text-[20px] ${
                              room.type === "memo"
                                ? "bg-green-600"
                                : "bg-[#444]"
                            }`}
                          >
                            {room.avatar ||
                              displayNameFor(room).charAt(0).toUpperCase()}
                          </span>
                        )}
                    </span>
                    <span class="pl-[10px] flex flex-col justify-center min-w-0 w-full">
                      <span class="text-[14px] text-white flex justify-between items-center w-full whitespace-nowrap overflow-hidden text-ellipsis">
                        <span class="font-bold flex-1">
                          {displayNameFor(room)}
                        </span>
                        <span
                          class="text-[10px] text-gray-500 ml-1 whitespace-nowrap"
                          style="text-align:right;"
                        >
                          {room.lastMessageTime
                            ? room.lastMessageTime.toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                            : ""}
                        </span>
                      </span>
                      <span class="text-[12px] text-[#aaaaaa] font-normal flex justify-between items-center">
                        <p class="truncate">{room.lastMessage}</p>
                      </span>
                    </span>
                  </div>
                </li>
              )}
            </For>
          </ul>
        </div>
      </SwipeTabs>
    </div>
  );
}

// チャットルーム一覧のスケルトン
function RoomListSkeleton() {
  const items = Array.from({ length: 6 });
  return (
    <ul>
      {items.map(() => (
        <li class="flex items-center h-16 rounded-lg mb-2 w-full bg-transparent">
          <div class="flex items-center w-full px-2">
            <span class="relative w-[40px] h-[40px] flex items-center justify-center">
              <Skeleton
                class="w-[40px] h-[40px] rounded-full"
                rounded="rounded-full"
              />
            </span>
            <span class="pl-[10px] flex flex-col justify-center min-w-0 w-full">
              <span class="flex justify-between items-center w-full">
                <Skeleton class="h-4 w-1/3" />
                <Skeleton class="h-3 w-12" />
              </span>
              <span class="mt-2 flex justify-between items-center w-full">
                <Skeleton class="h-3 w-2/3" />
              </span>
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
