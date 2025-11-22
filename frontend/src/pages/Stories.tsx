import { Show, createSignal } from "solid-js";
import AllStoriesBar from "../components/AllStoriesBar";
import HeaderBar from "../components/HeaderBar";
import type { Story } from "../lib/stories";

export default function Stories() {
  const [stories, setStories] = createSignal<Story[]>([]);

  return (
    <div class="min-h-screen bg-white dark:bg-black">
      <HeaderBar />
      <div class="max-w-2xl mx-auto">
        <AllStoriesBar onLoaded={(loadedStories) => setStories(loadedStories)} />
        <Show
          when={stories().length === 0}
        >
          <div class="p-6 text-center text-gray-500">
            ストーリーズがありません
          </div>
        </Show>
        <div class="px-4 py-6 text-center text-gray-600 dark:text-gray-400">
          <p class="text-sm">
            ストーリーズは24時間後に自動的に削除されます
          </p>
        </div>
      </div>
    </div>
  );
}
