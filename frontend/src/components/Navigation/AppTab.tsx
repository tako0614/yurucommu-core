import { A } from "@solidjs/router";
import { IconHome, IconMessage, IconPlus, IconUsers, IconUser } from "../icons";
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
      <A
        href="/"
        class="p-2 rounded-full active:bg-gray-100"
        aria-label="ホーム"
      >
        <IconHome />
      </A>
      {/* Messages (DM) */}
      <A
        href="/chat"
        class="p-2 rounded-full active:bg-gray-100"
        aria-label="チャット"
      >
        <IconMessage />
      </A>
      {/* Create */}
      <button
        class="p-2 rounded-full active:bg-gray-100"
        aria-label="作成"
        onClick={props.onOpenComposer}
      >
        <IconPlus />
      </button>
      {/* Connections (Friends & Communities) */}
      <A
        href="/connections"
        class="p-2 rounded-full active:bg-gray-100"
        aria-label="つながり"
      >
        <IconUsers />
      </A>
      {/* Profile */}
      <A
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
      </A>
    </div>
  );
}
