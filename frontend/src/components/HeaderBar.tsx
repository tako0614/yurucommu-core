import { createSignal, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { authStatus, logout } from "../lib/api";
import { IconMessage, IconPlus, IconSearch, IconUsers } from "./icons";

type Props = {
  onOpenComposer?: () => void;
};

export default function HeaderBar(props: Props) {
  const status = authStatus;
  const navigate = useNavigate();
  const [query, setQuery] = createSignal("");
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      const v = (query() || "").trim();
      if (v) navigate(`/c/${encodeURIComponent(v)}`);
    }
  };
  return (
    <header class="sticky top-0 z-30 bg-white border-b hairline">
      <div class="h-14 px-3 sm:px-4 lg:px-6 w-full flex items-center justify-between">
        {/* Left: simple wordmark */}
        <a href="/" class="text-[20px] font-medium tracking-tight">YuruCommu</a>
        {/* Right: minimal actions */}
        <div class="hidden sm:flex items-center gap-1 lg:gap-2">
          <button
            class="p-2 rounded-full hover:bg-gray-100 transition-opacity active:opacity-80"
            aria-label="作成"
            onClick={props.onOpenComposer}
          >
            <IconPlus />
          </button>
          <a
            href="/dm"
            class="p-2 rounded-full hover:bg-gray-100 transition-opacity active:opacity-80"
            aria-label="チャット"
          >
            <IconMessage />
          </a>
          <a
            href="/connections"
            class="p-2 rounded-full hover:bg-gray-100 transition-opacity active:opacity-80"
            aria-label="フォロー"
          >
            <IconUsers />
          </a>
          <div class="relative hidden md:block ml-1">
            <input
              class="w-48 lg:w-64 border hairline rounded-full pl-9 pr-3 py-2 text-sm bg-[#fafafa] focus:bg-white focus:outline-none"
              placeholder="コミュニティIDで検索 (Enter)"
              value={query()}
              onInput={(e) =>
                setQuery((e.currentTarget as HTMLInputElement).value)}
              onKeyDown={onKeyDown as any}
            />
            <span class="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400">
              <IconSearch size={18} strokeWidth={1.6} />
            </span>
          </div>
          <Show when={status() === "authenticated"}>
            <button
              class="ml-1 text-xs text-gray-700 hover:opacity-80"
              onClick={() => logout()}
            >
              ログアウト
            </button>
          </Show>
        </div>
      </div>
    </header>
  );
}
