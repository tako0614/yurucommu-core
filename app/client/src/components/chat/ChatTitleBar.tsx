import { Show } from "solid-js";
import type { Room } from "./types.ts";
import { isFriendRoom } from "./types.ts";
import { useAtom } from "solid-jotai";
import { activeAccount } from "../../states/account.ts";
import { getDomain } from "../../utils/config.ts";
import type { BindingStatus } from "../e2ee/binding.ts";

interface ChatTitleBarProps {
  isMobile: boolean;
  selectedRoom: Room | null;
  onBack: () => void;
  onOpenSettings: () => void; // 右上設定メニュー表示
  bindingStatus?: BindingStatus | null;
  bindingInfo?: { label: string; caution?: string } | null;
  ktInfo?: { included: boolean } | null;
}

export function ChatTitleBar(props: ChatTitleBarProps) {
  const [account] = useAtom(activeAccount);
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
    return undefined;
  };
  const titleFor = (room: Room | null): string => {
    if (!room) return "";
    if (room.type === "memo") return room.name;
    const me = account();
    if (!me) return room.displayName || room.name;
    // 明示的な displayName があれば尊重
    if (room.displayName && room.displayName.trim() !== "") return room.displayName;
    const selfHandle = `${me.userName}@${getDomain()}`;
    if (isFriendRoom(room)) {
      const other = (room.members ?? []).find((m) => m !== selfHandle) ?? room.members?.[0];
      const otherId = normalizeHandle(typeof other === "string" ? other : undefined);
      if (!room.name || room.name === me.displayName || room.name === me.userName || room.name === selfHandle) {
        if (otherId && otherId !== selfHandle) return otherId;
        // 相手未確定なら pendingInvites から推定（接尾辞は付けない）
        const cand = (room.pendingInvites && room.pendingInvites[0]) || undefined;
        const guess = normalizeHandle(typeof cand === "string" ? cand : undefined);
        if (guess && guess !== selfHandle) {
          const short = guess.includes("@") ? guess.split("@")[0] : guess;
          return short;
        }
        // 何も推定できない場合は空文字
        return "";
      }
    }
    // グループで自分名/自分ハンドルがタイトルに入ってしまっている場合は空で返す
    if (room.name === me.displayName || room.name === me.userName || room.name === selfHandle) return "";
    return room.name;
  };
  return (
    <div
      class={`absolute w-full h-12 flex items-center font-bold text-[20px] border-b border-[#333333] bg-[rgba(30,30,30,0.85)] backdrop-blur-md shadow-[0_3px_18px_rgba(0,0,0,0.2)] text-white z-[2] md:px-[18px] ${
        props.selectedRoom ? "" : "hidden"
      }`}
      id="chatHeader"
    >
      <div class="flex items-center gap-2 p-4">
        <Show when={props.isMobile}>
          <button type="button" class="h-full" onClick={props.onBack}>
            <svg
              role="img"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              stroke="#ffffff"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              fill="none"
              class="w-5 h-5"
            >
              <polyline points="14 18 8 12 14 6" />
            </svg>
          </button>
        </Show>
        <h2>{titleFor(props.selectedRoom)}</h2>
        <Show when={props.bindingInfo}>
          <span class="ml-2 px-2 py-0.5 text-xs bg-[#444] rounded">
            {props.bindingInfo!.label}
          </span>
        </Show>
        <Show
          when={props.bindingStatus !== "Verified" &&
            props.bindingInfo?.caution}
        >
          <span class="ml-2 text-xs text-yellow-400">
            {props.bindingInfo!.caution}
          </span>
        </Show>
        <Show when={props.ktInfo && !props.ktInfo.included}>
          <span class="ml-2 text-xs text-yellow-400">監査未検証</span>
        </Show>
      </div>
      <div class="ml-auto pr-4 flex items-center gap-3">
        <button
          type="button"
          aria-label="Chat settings"
          class="p-2 rounded hover:bg-white/10 transition-colors"
          onClick={props.onOpenSettings}
        >
          {/* ハンバーガー / カスタム アイコン */}
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            fill="none"
            class="text-white"
          >
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
