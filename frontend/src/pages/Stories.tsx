import { Show } from "solid-js";
import AllStoriesBar from "../components/AllStoriesBar";
import HeaderBar from "../components/HeaderBar";

export default function Stories() {
  return (
    <div class="min-h-screen bg-white dark:bg-black">
      <HeaderBar title="ストーリーズ" />
      <div class="max-w-2xl mx-auto">
        <Show
          when={true}
          fallback={
            <div class="p-6 text-center text-gray-500">
              ストーリーズがありません
            </div>
          }
        >
          <AllStoriesBar />
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
