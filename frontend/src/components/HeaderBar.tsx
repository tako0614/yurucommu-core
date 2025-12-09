import type React from "react";
import { createSignal, Show } from "../lib/solid-compat";
import { useNavigate, Link } from "react-router-dom";
import { useAuthStatus, logout } from "../lib/api";
import { IconMessage, IconPlus, IconSearch, IconUsers } from "./icons";

type Props = {
  onOpenComposer?: () => void;
};

export default function HeaderBar(props: Props) {
  const status = useAuthStatus();
  const navigate = useNavigate();
  const [query, setQuery] = createSignal("");
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      const v = (query() || "").trim();
      if (v) navigate(`/c/${encodeURIComponent(v)}`);
    }
  };
  return (
    <header className="sticky top-0 z-30 bg-white border-b hairline">
      <div className="h-14 px-3 sm:px-4 lg:px-6 w-full flex items-center justify-between">
        {/* Left: simple wordmark */}
        <Link to="/" className="text-[20px] font-medium tracking-tight">YuruCommu</Link>
        {/* Right: minimal actions */}
        <div className="hidden sm:flex items-center gap-1 lg:gap-2">
          <button
            className="p-2 rounded-full hover:bg-gray-100 transition-opacity active:opacity-80"
            aria-label="作成"
            onClick={props.onOpenComposer}
          >
            <IconPlus />
          </button>
          <Link
            to="/dm"
            className="p-2 rounded-full hover:bg-gray-100 transition-opacity active:opacity-80"
            aria-label="チャット"
          >
            <IconMessage />
          </Link>
          <Link
            to="/connections"
            className="p-2 rounded-full hover:bg-gray-100 transition-opacity active:opacity-80"
            aria-label="フォロー"
          >
            <IconUsers />
          </Link>
          <div className="relative hidden md:block ml-1">
            <input
              className="w-48 lg:w-64 border hairline rounded-full pl-9 pr-3 py-2 text-sm bg-[#fafafa] focus:bg-white focus:outline-none"
              placeholder="コミュニティIDで検索 (Enter)"
              value={query()}
              onChange={(e) => setQuery(e.currentTarget.value)}
              onKeyDown={onKeyDown}
            />
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400">
              <IconSearch size={18} strokeWidth={1.6} />
            </span>
          </div>
          <Show when={status === "authenticated"}>
            <button
              className="ml-1 text-xs text-gray-700 hover:opacity-80"
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
