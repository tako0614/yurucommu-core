import { createSignal, For } from "solid-js";
import type { Story } from "./types.ts";
import { createStory, deleteStory, viewStory } from "./api.ts";
import { UserAvatar } from "./UserAvatar.tsx";

export function StoryTray(props: {
  stories: Story[];
  refetchStories: () => void;
  handleViewStory: (story: Story, index: number) => void;
}) {
  const [showStoryForm, setShowStoryForm] = createSignal(false);
  const [storyContent, setStoryContent] = createSignal("");
  const [storyMediaUrl, setStoryMediaUrl] = createSignal("");
  const [storyBackgroundColor, setStoryBackgroundColor] = createSignal(
    "#1DA1F2",
  );
  const [storyTextColor, setStoryTextColor] = createSignal("#FFFFFF");

  const storyBackgroundColors = [
    "#1DA1F2",
    "#E91E63",
    "#9C27B0",
    "#673AB7",
    "#3F51B5",
    "#2196F3",
    "#00BCD4",
    "#009688",
    "#4CAF50",
    "#FF9800",
    "#FF5722",
    "#795548",
    "#607D8B",
    "#000000",
  ];

  const handleCreateStory = async (e: Event) => {
    e.preventDefault();
    const content = storyContent().trim();
    if (!content) return;

    const success = await createStory(
      content,
      storyMediaUrl() || undefined,
      undefined,
      storyBackgroundColor(),
      storyTextColor(),
    );

    if (success) {
      setStoryContent("");
      setStoryMediaUrl("");
      setShowStoryForm(false);
      props.refetchStories();
    } else {
      alert("ストーリーの作成に失敗しました");
    }
  };

  return (
    <>
      <div class="border-b border-gray-800 py-4 px-4">
        <div class="flex items-center space-x-4 overflow-x-auto scrollbar-hide">
          {/* ストーリー作成ボタン */}
          <button
            type="button"
            onClick={() => setShowStoryForm(true)}
            class="flex-shrink-0 flex flex-col items-center space-y-2 cursor-pointer"
          >
            <div class="w-16 h-16 border-2 border-dashed border-gray-600 rounded-full flex items-center justify-center hover:border-blue-400 transition-colors">
              <svg
                class="w-6 h-6 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                />
              </svg>
            </div>
            <span class="text-xs text-gray-400">ストーリー</span>
          </button>

          {/* ストーリー一覧 */}
          <For each={props.stories}>
            {(story, index) => (
              <button
                type="button"
                onClick={() => props.handleViewStory(story, index())}
                class="flex-shrink-0 flex flex-col items-center space-y-2 cursor-pointer group"
              >
                <div
                  class={`w-16 h-16 rounded-full p-0.5 ${
                    story.isViewed
                      ? "bg-gray-600"
                      : "bg-gradient-to-tr from-yellow-400 via-red-500 to-pink-500"
                  }`}
                >
                  <div class="w-full h-full bg-black rounded-full flex items-center justify-center overflow-hidden">
                    {story.mediaUrl
                      ? (
                        <img
                          src={story.mediaUrl}
                          alt=""
                          class="w-full h-full object-cover rounded-full"
                        />
                      )
                      : (
                        <div class="w-full h-full rounded-full overflow-hidden">
                          <UserAvatar
                            username={story.author}
                            size="w-full h-full"
                            className="border-0"
                          />
                        </div>
                      )}
                  </div>
                </div>
                <span class="text-xs text-gray-400 group-hover:text-white transition-colors max-w-16 truncate">
                  {story.author}
                </span>
              </button>
            )}
          </For>
        </div>
      </div>

      {/* ストーリー作成フォーム（モーダル形式） */}
      {showStoryForm() && (
        <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div class="bg-gray-900 rounded-xl p-6 w-full max-w-lg mx-4 border border-gray-700">
            <div class="flex items-center justify-between mb-4">
              <h2 class="text-lg font-bold">新しいストーリー</h2>
              <button
                type="button"
                onClick={() => setShowStoryForm(false)}
                class="text-gray-400 hover:text-white p-2 rounded-full hover:bg-gray-800"
              >
                <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fill-rule="evenodd"
                    d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                    clip-rule="evenodd"
                  />
                </svg>
              </button>
            </div>

            <form onSubmit={handleCreateStory} class="space-y-4">
              {/* プレビュー */}
              <div
                class="aspect-[9/16] rounded-xl p-4 flex flex-col justify-center items-center text-center relative overflow-hidden"
                style={`background: ${storyBackgroundColor()}; color: ${storyTextColor()}`}
              >
                {storyMediaUrl() && (
                  <img
                    src={storyMediaUrl()}
                    alt=""
                    class="absolute inset-0 w-full h-full object-cover"
                  />
                )}
                <div class="relative z-10">
                  <div class="text-lg font-bold mb-2">
                    {storyContent() || "ここにテキストが表示されます"}
                  </div>
                </div>
              </div>

              {/* テキスト入力 */}
              <textarea
                value={storyContent()}
                onInput={(e) => setStoryContent(e.currentTarget.value)}
                placeholder="ストーリーに何か書いてみましょう..."
                maxlength={200}
                class="w-full bg-gray-800 rounded-lg p-3 text-white placeholder-gray-500 resize-none border border-gray-700 focus:border-blue-500 outline-none"
                rows={3}
              />

              {/* 背景色選択 */}
              <div>
                <label class="block text-sm font-medium text-gray-300 mb-2">
                  背景色
                </label>
                <div class="flex space-x-2 flex-wrap gap-2">
                  <For each={storyBackgroundColors}>
                    {(color) => (
                      <button
                        type="button"
                        onClick={() => setStoryBackgroundColor(color)}
                        class={`w-8 h-8 rounded-full border-2 ${
                          storyBackgroundColor() === color
                            ? "border-white"
                            : "border-gray-600"
                        }`}
                        style={`background: ${color}`}
                      />
                    )}
                  </For>
                </div>
              </div>

              {/* テキスト色選択 */}
              <div>
                <label class="block text-sm font-medium text-gray-300 mb-2">
                  テキスト色
                </label>
                <div class="flex space-x-2">
                  <button
                    type="button"
                    onClick={() => setStoryTextColor("#FFFFFF")}
                    class={`w-8 h-8 rounded-full border-2 ${
                      storyTextColor() === "#FFFFFF"
                        ? "border-blue-500"
                        : "border-gray-600"
                    } bg-white`}
                  />
                  <button
                    type="button"
                    onClick={() => setStoryTextColor("#000000")}
                    class={`w-8 h-8 rounded-full border-2 ${
                      storyTextColor() === "#000000"
                        ? "border-blue-500"
                        : "border-gray-600"
                    } bg-black`}
                  />
                </div>
              </div>

              {/* メディアURL */}
              <input
                type="url"
                value={storyMediaUrl()}
                onInput={(e) => setStoryMediaUrl(e.currentTarget.value)}
                placeholder="画像URLを入力（オプション）"
                class="w-full bg-gray-800 rounded-lg p-3 text-white placeholder-gray-500 border border-gray-700 focus:border-blue-500 outline-none"
              />

              <div class="flex items-center justify-between">
                <span class="text-sm text-gray-500">
                  {storyContent().length}/200
                </span>
                <button
                  type="submit"
                  class={`px-6 py-2 rounded-full font-bold transition-all duration-200 ${
                    !storyContent().trim() || storyContent().length > 200
                      ? "bg-blue-400/50 text-white/50 cursor-not-allowed"
                      : "bg-blue-500 hover:bg-blue-600 text-white shadow-lg hover:shadow-xl transform hover:scale-105"
                  }`}
                  disabled={!storyContent().trim() ||
                    storyContent().length > 200}
                >
                  ストーリーを作成
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

export function StoryViewer(props: {
  showStoryViewer: boolean;
  selectedStory: Story | null;
  stories: Story[];
  currentStoryIndex: number;
  previousStory: () => void;
  nextStory: () => void;
  closeStoryViewer: () => void;
  handleDeleteStory: (id: string) => void;
  formatDate: (dateString: string) => string;
}) {
  return (
    <>
      {props.showStoryViewer && props.selectedStory && (
        <div class="fixed inset-0 bg-black z-50 flex items-center justify-center">
          <div class="relative w-full max-w-sm h-full">
            {/* 進行状況バー */}
            <div class="absolute top-4 left-4 right-4 z-20 flex space-x-1">
              <For each={props.stories}>
                {(_, index) => (
                  <div class="flex-1 h-1 bg-gray-600 rounded">
                    <div
                      class={`h-full bg-white rounded transition-all duration-300 ${
                        index() < props.currentStoryIndex
                          ? "w-full"
                          : index() === props.currentStoryIndex
                          ? "w-full"
                          : "w-0"
                      }`}
                    />
                  </div>
                )}
              </For>
            </div>

            {/* ストーリーコンテンツ */}
            <div class="w-full h-full relative">
              {props.selectedStory!.mediaUrl && (
                <img
                  src={props.selectedStory!.mediaUrl}
                  alt=""
                  class="w-full h-full object-cover"
                />
              )}
              <div
                class="absolute inset-0 flex flex-col justify-end p-6"
                style={!props.selectedStory!.mediaUrl
                  ? `background-color: ${
                    props.selectedStory!.backgroundColor
                  };` +
                    `color: ${props.selectedStory!.textColor};`
                  : "background: linear-gradient(transparent, rgba(0,0,0,0.7))"}
              >
                <div class="text-white">
                  <div class="flex items-center space-x-2 mb-2">
                    <span class="font-bold text-lg">
                      {props.selectedStory!.author}
                    </span>
                    <span class="text-sm opacity-75">
                      {props.formatDate(props.selectedStory!.createdAt)}
                    </span>
                  </div>
                  <div class="text-lg leading-relaxed">
                    {props.selectedStory!.content}
                  </div>
                </div>
              </div>
            </div>

            {/* ナビゲーションエリア */}
            <div class="absolute inset-0 flex">
              <button
                type="button"
                onClick={props.previousStory}
                class="flex-1 opacity-0 hover:opacity-10 bg-black transition-opacity"
              />
              <button
                type="button"
                onClick={props.nextStory}
                class="flex-1 opacity-0 hover:opacity-10 bg-black transition-opacity"
              />
            </div>

            {/* 閉じるボタン */}
            <button
              type="button"
              onClick={props.closeStoryViewer}
              class="absolute top-4 right-4 z-20 text-white p-2 rounded-full bg-black/50 hover:bg-black/70 transition-colors"
            >
              <svg class="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fill-rule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clip-rule="evenodd"
                />
              </svg>
            </button>

            {/* 削除ボタン（自分のストーリーの場合） */}
            {props.selectedStory!.author === "user" && (
              <button
                type="button"
                onClick={() => props.handleDeleteStory(props.selectedStory!.id)}
                class="absolute bottom-4 right-4 z-20 text-white p-2 rounded-full bg-red-500/50 hover:bg-red-500/70 transition-colors"
              >
                <svg
                  class="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
