import { For, Show, createSignal } from "solid-js";
import AllStoriesBar from "../components/AllStoriesBar";
import HeaderBar from "../components/HeaderBar";
import StoryViewer from "../components/StoryViewer";
import type { Story } from "../lib/stories";

export default function Stories() {
  const [stories, setStories] = createSignal<Story[]>([]);
  const [viewerIndex, setViewerIndex] = createSignal<number | null>(null);

  const openViewer = (index: number) => {
    setViewerIndex(index);
  };

  const closeViewer = () => {
    setViewerIndex(null);
  };

  return (
    <div class="min-h-screen bg-white dark:bg-black">
      <HeaderBar />
      <div class="max-w-2xl mx-auto">
        <AllStoriesBar
          onLoaded={(loadedStories) => setStories(loadedStories)}
          onOpenViewer={openViewer}
        />
        <Show when={stories().length === 0}>
          <div class="p-6 text-center text-gray-500">
            ストーリーズがありません
          </div>
        </Show>
        <Show when={stories().length > 0}>
          <div class="px-4 py-6">
            <div class="text-lg font-semibold mb-4">すべてのストーリー</div>
            <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <For each={stories()}>
                {(story, index) => (
                  <button
                    class="relative aspect-[9/16] rounded-xl overflow-hidden bg-gray-100 dark:bg-gray-800 hover:opacity-90 transition-opacity"
                    onClick={() => openViewer(index())}
                  >
                    <Show when={story.items && story.items.length > 0}>
                      <Show when={story.items[0].type === "image"}>
                        <img
                          src={(story.items[0] as any).url}
                          alt="ストーリー"
                          class="w-full h-full object-cover"
                        />
                      </Show>
                      <Show when={story.items[0].type === "text"}>
                        <div
                          class="w-full h-full flex items-center justify-center p-4 bg-gradient-to-br from-purple-500 to-pink-500"
                        >
                          <div class="text-white text-sm font-medium text-center line-clamp-3">
                            {(story.items[0] as any).text || ""}
                          </div>
                        </div>
                      </Show>
                    </Show>
                    <div class="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/60 to-transparent">
                      <div class="text-white text-xs font-medium truncate">
                        {story.author_id}
                      </div>
                      <div class="text-white/80 text-xs">
                        {new Date(story.created_at).toLocaleString()}
                      </div>
                    </div>
                  </button>
                )}
              </For>
            </div>
          </div>
        </Show>
        <div class="px-4 py-6 text-center text-gray-600 dark:text-gray-400">
          <p class="text-sm">
            ストーリーズは24時間後に自動的に削除されます
          </p>
        </div>
      </div>

      <Show when={viewerIndex() !== null}>
        <StoryViewer
          stories={stories()}
          startIndex={viewerIndex()!}
          onClose={closeViewer}
        />
      </Show>
    </div>
  );
}
