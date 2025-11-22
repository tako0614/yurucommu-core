import { IconHome, IconMessage, IconPlus, IconStory, IconUsers } from "../icons";

type Props = {
  onOpenComposer?: () => void;
};

export default function AppTab(props: Props) {

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
      {/* Stories */}
      <a
        href="/stories"
        class="p-2 rounded-full active:bg-gray-100"
        aria-label="ストーリーズ"
      >
        <IconStory />
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
    </div>
  );
}
