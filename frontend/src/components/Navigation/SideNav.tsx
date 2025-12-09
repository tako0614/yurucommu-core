import { Link } from "react-router-dom";
import {
  IconHeart,
  IconHome,
  IconMessage,
  IconPlus,
  IconSettings,
  IconUser,
  IconUsers,
  IconSearch,
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
    <nav className="hidden md:flex flex-col gap-3 md:pt-12 md:pb-6 border-r hairline min-h-dvh md:w-[72px] xl:w-[220px] items-center xl:items-start">
      {/* Brand / Title */}
      <Link
        to="/"
        className="md:w-10 xl:w-full h-10 flex items-center justify-center xl:justify-start rounded-full px-0 xl:px-3 select-none"
      >
        {/* md: logo only, xl: wordmark */}
        <img src={logoUrl} alt="YuruCommu" className="md:h-6 md:w-6 xl:hidden" />
        <span className="hidden xl:inline text-[18px] font-semibold tracking-tight">
          YuruCommu
        </span>
      </Link>
      {/* Main list items */}
      <Link
        className="md:w-10 xl:w-full h-10 flex items-center justify-center xl:justify-start gap-0 xl:gap-3 rounded-full hover:bg-gray-100 active:opacity-80 px-0 xl:px-3"
        to="/"
        title="ホーム"
      >
        <IconHome />
        <span className="hidden xl:inline text-sm">ホーム</span>
      </Link>
      <button
        className="md:w-10 xl:w-full h-10 flex items-center justify-center xl:justify-start gap-0 xl:gap-3 rounded-full hover:bg-gray-100 active:opacity-80 px-0 xl:px-3"
        title="通知"
        onClick={props.onOpenNotifications}
      >
        <IconHeart />
        <span className="hidden xl:inline text-sm">通知</span>
      </button>
      <Link
        className="md:w-10 xl:w-full h-10 flex items-center justify-center xl:justify-start gap-0 xl:gap-3 rounded-full hover:bg-gray-100 active:opacity-80 px-0 xl:px-3"
        to="/chat"
        title="メッセージ"
      >
        <IconMessage />
        <span className="hidden xl:inline text-sm">メッセージ</span>
      </Link>
      <button
        className="md:w-10 xl:w-full h-10 flex items-center justify-center xl:justify-start gap-0 xl:gap-3 rounded-full hover:bg-gray-100 active:opacity-80 px-0 xl:px-3"
        title="作成"
        onClick={props.onOpenComposer}
      >
        <IconPlus />
        <span className="hidden xl:inline text-sm">作成</span>
      </button>
      <Link
        className="md:w-10 xl:w-full h-10 flex items-center justify-center xl:justify-start gap-0 xl:gap-3 rounded-full hover:bg-gray-100 active:opacity-80 px-0 xl:px-3"
        to="/connections"
        title="つながり"
      >
        <IconUsers />
        <span className="hidden xl:inline text-sm">つながり</span>
      </Link>
      <Link
        className="md:w-10 xl:w-full h-10 flex items-center justify-center xl:justify-start gap-0 xl:gap-3 rounded-full hover:bg-gray-100 active:opacity-80 px-0 xl:px-3"
        to="/profile"
        title="プロフィール"
      >
        {me()?.avatar_url ? (
          <Avatar
            src={me()!.avatar_url || undefined}
            alt="プロフィール"
            className="w-6 h-6 rounded-full object-cover"
          />
        ) : (
          <IconUser />
        )}
        <span className="hidden xl:inline text-sm">プロフィール</span>
      </Link>
      <div className="flex-1" />
      <Link
        className="md:w-10 xl:w-full h-10 flex items-center justify-center xl:justify-start gap-0 xl:gap-3 rounded-full hover:bg-gray-100 active:opacity-80 px-0 xl:px-3"
        to="/users"
        title="ユーザー検索"
      >
        <IconSearch />
        <span className="hidden xl:inline text-sm">検索</span>
      </Link>
      {/* Bottom actions */}
      <Link
        className="md:w-10 xl:w-full h-10 flex items-center justify-center xl:justify-start gap-0 xl:gap-3 rounded-full hover:bg-gray-100 active:opacity-80 px-0 xl:px-3"
        to="/settings"
        title="設定"
      >
        <IconSettings />
        <span className="hidden xl:inline text-sm">設定</span>
      </Link>
    </nav>
  );
}
