import { IconHome, IconMessage, IconPlus, IconUser, IconUsers } from "../icons";
import Avatar from "../Avatar";
import { useMe } from "../../lib/api";

type Props = {
  onOpenComposer?: () => void;
};

export default function AppTab(props: Props) {
  const me = useMe();

  return (
    <div class="fixed bottom-0 left-0 right-0 md:hidden h-14 border-t hairline bg-white dark:bg-neutral-900 flex items-center justify-around pb-[env(safe-area-inset-bottom)]">
      {/* Home */}
      <a
        href="/"
        class="p-2 rounded-full active:bg-gray-100"
        aria-label="ホーム"
      >
        <IconHome />
      </a>
      {/* Messages (DM) */}
      <a
        href="/dm"
        class="p-2 rounded-full active:bg-gray-100"
        aria-label="チャット"
      >
        <IconMessage />
      </a>
      {/* Create */}
      <button
        class="p-2 rounded-full active:bg-gray-100"
        aria-label="作成"
        onClick={props.onOpenComposer}
      >
        <IconPlus />
      </button>
      {/* Friends */}
      <a
        href="/friends"
        class="p-2 rounded-full active:bg-gray-100"
        aria-label="友達"
      >
        <IconUsers />
      </a>
      {/* Profile */}
      <a
        href="/profile"
        class="p-2 rounded-full active:bg-gray-100"
        aria-label="プロフィール"
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
      </a>
    </div>
  );
}
