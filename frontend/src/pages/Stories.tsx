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

  const nextStory = () => {
    const current = viewerIndex();
    if (current !== null && current < stories().length - 1) {
      setViewerIndex(current + 1);
    }
  };

  const prevStory = () => {
    const current = viewerIndex();
    if (current !== null && current > 0) {
      setViewerIndex(current - 1);
    }
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
                    <Show when={story.elements && story.elements.length > 0}>
                      <Show when={story.elements![0].type === "image" && story.elements![0].url}>
                        <img
                          src={story.elements![0].url!}
                          alt="ストーリー"
                          class="w-full h-full object-cover"
                        />
                      </Show>
                      <Show when={story.elements![0].type === "text"}>
                        <div
                          class="w-full h-full flex items-center justify-center p-4"
                          style={{
                            background: story.background_style === "gradient"
                              ? "linear-gradient(135deg, #667eea 0%, #764ba2 100%)"
                              : story.background_style === "solid"
                              ? "#1a1a1a"
                              : "transparent",
                          }}
                        >
                          <div class="text-white text-sm font-medium text-center line-clamp-3">
                            {story.elements![0].content}
                          </div>
                        </div>
                      </Show>
                    </Show>
                    <div class="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/60 to-transparent">
                      <div class="text-white text-xs font-medium truncate">
                        {story.author_display_name || "Unknown"}
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
          initialIndex={viewerIndex()!}
          onClose={closeViewer}
          onNext={nextStory}
          onPrev={prevStory}
        />
      </Show>
    </div>
  );
}
