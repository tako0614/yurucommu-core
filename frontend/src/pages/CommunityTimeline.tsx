import { useParams } from "@solidjs/router";
import { createResource, createSignal, For, Show } from "solid-js";
import { api } from "../lib/api";
import StoriesBar from "../components/StoriesBar";
import StoryViewer from "../components/StoryViewer";
import type { Story } from "../lib/stories";
import PostCard from "../components/PostCard";

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

export default function CommunityTimeline() {
  const params = useParams();
  const [community] = createResource(async () =>
    api(`/communities/${params.id}`)
  );
  const [posts, { refetch, mutate: setPosts }] = createResource(async () =>
    api(`/communities/${params.id}/posts`)
  );
  const handlePostUpdated = (updated: any) => {
    setPosts((prev) => {
      if (!Array.isArray(prev)) return prev;
      return prev.map((p: any) =>
        p.id === updated?.id ? { ...p, ...updated } : p,
      );
    });
  };
  const handlePostDeleted = (id: string) => {
    setPosts((prev) => {
      if (!Array.isArray(prev)) return prev;
      return prev.filter((p: any) => p.id !== id);
    });
  };
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
            {(p: any) => (
              <PostCard
                post={{
                  ...p,
                  community_name: community()?.name || (p as any).community_name,
                  community_icon_url: community()?.icon_url || (p as any).community_icon_url,
                }}
                onUpdated={handlePostUpdated}
                onDeleted={handlePostDeleted}
              />
            )}
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
