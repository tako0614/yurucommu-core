import {
  IconHeart,
  IconHome,
  IconMessage,
  IconPlus,
  IconSettings,
  IconStory,
  IconUser,
  IconUsers,
} from "../icons";
import logoUrl from "../../assets/solid.svg";
import Avatar from "../Avatar";
import { useMe } from "../../lib/api";

type Props = {
  onOpenComposer?: () => void;
  onOpenNotifications?: () => void;
};

export default function SideNav(props: Props) {
  const me = useMe();

  return (
    <nav class="hidden md:flex flex-col gap-3 md:pt-12 md:pb-6 border-r hairline min-h-dvh md:w-[72px] xl:w-[220px] items-center xl:items-start">
      {/* Brand / Title */}
      <a
        href="/"
        class="md:w-10 xl:w-full h-10 flex items-center justify-center xl:justify-start rounded-full px-0 xl:px-3 select-none"
      >
        {/* md: logo only, xl: wordmark */}
        <img src={logoUrl} alt="YuruCommu" class="md:h-6 md:w-6 xl:hidden" />
        <span class="hidden xl:inline text-[18px] font-semibold tracking-tight">
          YuruCommu
        </span>
      </a>
      {/* Main list items */}
      <a
        class="md:w-10 xl:w-full h-10 flex items-center justify-center xl:justify-start gap-0 xl:gap-3 rounded-full hover:bg-gray-100 active:opacity-80 px-0 xl:px-3"
        href="/"
        title="ホーム"
      >
        <IconHome />
        <span class="hidden xl:inline text-sm">ホーム</span>
      </a>
      <a
        class="md:w-10 xl:w-full h-10 flex items-center justify-center xl:justify-start gap-0 xl:gap-3 rounded-full hover:bg-gray-100 active:opacity-80 px-0 xl:px-3"
        href="/stories"
        title="ストーリーズ"
      >
        <IconStory />
        <span class="hidden xl:inline text-sm">ストーリーズ</span>
      </a>
      <button
        class="md:w-10 xl:w-full h-10 flex items-center justify-center xl:justify-start gap-0 xl:gap-3 rounded-full hover:bg-gray-100 active:opacity-80 px-0 xl:px-3"
        title="通知"
        onClick={props.onOpenNotifications}
      >
        <IconHeart />
        <span class="hidden xl:inline text-sm">通知</span>
      </button>
      <a
        class="md:w-10 xl:w-full h-10 flex items-center justify-center xl:justify-start gap-0 xl:gap-3 rounded-full hover:bg-gray-100 active:opacity-80 px-0 xl:px-3"
        href="/chat"
        title="メッセージ"
      >
        <IconMessage />
        <span class="hidden xl:inline text-sm">メッセージ</span>
      </a>
      <button
        class="md:w-10 xl:w-full h-10 flex items-center justify-center xl:justify-start gap-0 xl:gap-3 rounded-full hover:bg-gray-100 active:opacity-80 px-0 xl:px-3"
        title="作成"
        onClick={props.onOpenComposer}
      >
        <IconPlus />
        <span class="hidden xl:inline text-sm">作成</span>
      </button>
      <a
        class="md:w-10 xl:w-full h-10 flex items-center justify-center xl:justify-start gap-0 xl:gap-3 rounded-full hover:bg-gray-100 active:opacity-80 px-0 xl:px-3"
        href="/friends"
        title="友達"
      >
        <IconUsers />
        <span class="hidden xl:inline text-sm">友達</span>
      </a>
      <a
        class="md:w-10 xl:w-full h-10 flex items-center justify-center xl:justify-start gap-0 xl:gap-3 rounded-full hover:bg-gray-100 active:opacity-80 px-0 xl:px-3"
        href="/profile"
        title="プロフィール"
      >
        {me()?.avatar_url ? (
          <Avatar
            src={me()!.avatar_url || undefined}
            alt="プロフィール"
            class="w-6 h-6 rounded-full object-cover"
          />
        ) : (
          <IconUser />
        )}
        <span class="hidden xl:inline text-sm">プロフィール</span>
      </a>
      <div class="flex-1" />
      {/* Bottom actions */}
      <a
        class="md:w-10 xl:w-full h-10 flex items-center justify-center xl:justify-start gap-0 xl:gap-3 rounded-full hover:bg-gray-100 active:opacity-80 px-0 xl:px-3"
        href="/settings"
        title="設定"
      >
        <IconSettings />
        <span class="hidden xl:inline text-sm">設定</span>
      </a>
    </nav>
  );
}
