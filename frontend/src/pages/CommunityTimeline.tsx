import { useParams } from "@solidjs/router";
import { createResource, createSignal, For, Show } from "solid-js";
import { api, getUser } from "../lib/api";
import StoriesBar from "../components/StoriesBar";
import StoryViewer from "../components/StoryViewer";
import type { Story } from "../lib/stories";
import Avatar from "../components/Avatar";

function PostComposer(props: { onSubmit: (text: string) => Promise<void> }) {
  const submit = async (e: Event) => {
    e.preventDefault();
    const input = (e.target as HTMLFormElement).querySelector(
      "input",
    ) as HTMLInputElement;
    const t = input?.value?.trim();
    if (!t) return;
    await props.onSubmit(t);
    input.value = "";
  };
  return (
    <form
      class="my-4 flex gap-2 bg-white dark:bg-neutral-900 border rounded-xl p-3"
      onSubmit={submit}
    >
      <div class="w-9 h-9 rounded-full bg-gray-200 dark:bg-neutral-700" />
      <input
        class="flex-1 rounded-full px-4 py-2 bg-gray-50 border"
        placeholder="投稿を書く…"
      />
      <button class="px-4 py-2 rounded-full bg-gray-900 text-white">
        投稿
      </button>
    </form>
  );
}

function FeedItem(props: { p: any; community: any }) {
  const [author] = createResource(async () =>
    getUser(props.p.author_id).catch(() => null)
  );
  return (
    <article class="bg-white dark:bg-neutral-900 border rounded-xl">
      {/* Community header */}
      <div class="px-3 pt-2 flex items-center gap-2 text-xs text-gray-500">
        <img
          src={props.community?.icon_url || ""}
          alt="コミュニティ"
          class="w-4 h-4 rounded"
        />
        <a href={`/c/${props.community?.id}`} class="hover:underline">
          {props.community?.name}
        </a>
      </div>
      <Show when={author()}>
        <div class="px-3 pt-2 flex items-start gap-3">
          <a
            href={`/@${encodeURIComponent((props.p as any).author_handle || props.p.author_id)}`}
            class="flex-shrink-0"
          >
            <Avatar
              src={author()?.avatar_url || ""}
              alt="アバター"
              class="w-10 h-10 rounded-full bg-gray-200 dark:bg-neutral-700 object-cover"
            />
          </a>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1 text-[14px]">
              <a
                href={`/@${encodeURIComponent((props.p as any).author_handle || props.p.author_id)}`}
                class="font-semibold hover:underline"
              >
                {author()?.display_name}
              </a>
            <span class="text-gray-500">·</span>
            <span class="text-gray-500">{props.p.created_at}</span>
          </div>
          <div class="mt-1 whitespace-pre-wrap text-[15px] leading-relaxed">
            {props.p.text}
          </div>
        </div>
      </div>
      <div class="px-3 pb-3 pt-2 flex items-center gap-4 text-sm">
        <button class="hover:opacity-80">❤️ 0</button>
        <button class="hover:opacity-80">👍 0</button>
        <button class="hover:opacity-80 ml-auto">コメント</button>
      </div>
    </Show>
    </article>
  );
}

export default function CommunityTimeline() {
  const params = useParams();
  const [community] = createResource(async () =>
    api(`/communities/${params.id}`)
  );
  const [posts, { refetch }] = createResource(async () =>
    api(`/communities/${params.id}/posts`)
  );
  const [storyList, setStoryList] = createSignal<Story[] | null>(null);
  const [viewerIndex, setViewerIndex] = createSignal<number | null>(null);
  const [showSidebarMobile, setShowSidebarMobile] = createSignal(false);

  const submit = async (text: string) => {
    await api(`/communities/${params.id}/posts`, {
      method: "POST",
      body: JSON.stringify({ text, type: "text" }),
    });
    await refetch();
  };

  return (
    <div class="mx-auto w-full max-w-[1400px] px-4 md:px-6 grid md:grid-cols-[1fr_400px] gap-6">
      <div class="md:hidden fixed top-4 right-4 z-50">
        <button
          aria-label="サイドパネルを開く"
          class="p-2 rounded-full bg-white dark:bg-neutral-900 border hairline shadow"
          onClick={() => setShowSidebarMobile((v) => !v)}
        >
          <svg
            class="w-5 h-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M3 12h18M3 6h18M3 18h18" />
          </svg>
        </button>
      </div>
      <div>
        <Show when={community()}>
          <div class="text-lg font-semibold mt-4 mb-3">{community()!.name}</div>
        </Show>
        <StoriesBar
          onOpenViewer={(i) => setViewerIndex(i)}
          onLoaded={(arr) => setStoryList(arr)}
        />
        <PostComposer onSubmit={submit} />
        <div class="grid gap-3 pb-24">
          <For each={posts() || []}>
            {(p: any) => <FeedItem p={p} community={community()} />}
          </For>
        </div>
        <Show when={viewerIndex() !== null && storyList()}>
          <StoryViewer
            stories={storyList()!}
            startIndex={viewerIndex()!}
            onClose={() => setViewerIndex(null)}
            onUpdated={(arr) => setStoryList(arr)}
          />
        </Show>
      </div>

      {/* 右カラム：固定パネル（メンバー/ピン/詳細など）。モバイルでも表示し、sticky は md 以上のみ */}
      <aside class="hidden md:block pt-4">
        <div class="bg-white dark:bg-neutral-900 border rounded-xl p-4 sticky md:top-[72px]">
          <div class="font-semibold mb-2">概要</div>
          <div class="text-sm text-gray-600">
            このコミュニティの説明やピン留めなどを表示予定。
          </div>
        </div>
      </aside>

      <Show when={showSidebarMobile()}>
        <div class="fixed inset-0 z-40">
          <div
            class="absolute inset-0 bg-black/40"
            onClick={() => setShowSidebarMobile(false)}
          />
          <div class="absolute right-0 top-0 h-full w-[320px] max-w-[90%] bg-white dark:bg-neutral-900 border-l hairline p-4 overflow-auto">
            <div class="flex items-center justify-between">
              <div class="font-semibold">概要</div>
              <button
                class="p-1"
                onClick={() => setShowSidebarMobile(false)}
                aria-label="閉じる"
              >
                <svg
                  class="w-5 h-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div class="mt-2 text-sm">
              このコミュニティの説明やピン留めなどを表示予定。
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}
