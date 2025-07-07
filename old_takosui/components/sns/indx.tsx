import { createSignal, For, onMount, Show } from "solid-js";
import { Post, Story } from "../../types/sns";
import SnsApi from "../../api/snsApi";
import StoryItem from "./StoryItem";
import PostItem from "./PostItem";
import CreatePostForm from "./CreatePostForm";
import { userId } from "../../utils/userId"; // ユーザーIDをインポート
import { useAtom } from "solid-jotai";
import { iconState } from "../../utils/state";

export default function Sns() {
  const [posts, setPosts] = createSignal<Post[]>([]);
  const [stories, setStories] = createSignal<Story[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [showCreatePost, setShowCreatePost] = createSignal(false);
  const [showCreateStory, setShowCreateStory] = createSignal(false);
  const [postText, setPostText] = createSignal("");
  const [postImage, setPostImage] = createSignal<string | null>(null);
  const [storyImage, setStoryImage] = createSignal<string | null>(null);
  const [icon] = useAtom(iconState);
  // 自分のストーリーがあるかチェックする関数
  const hasMyStory = () => {
    return stories().some((story) => story.author.userName === userId);
  };

  // ストーリーを作成する関数
  const handleCreateStory = async () => {
    try {
      setError(null);
      // ここでストーリー作成APIを呼び出す
      if (storyImage()) {
        await SnsApi.createStory(storyImage()!);
      }

      // ストーリー作成後にタイムラインを再取得
      await loadTimeline();

      // フォームをリセットして閉じる
      setStoryImage(null);
      setShowCreateStory(false);
    } catch (err) {
      console.error("ストーリー作成中にエラーが発生しました:", err);
      setError("ストーリーの作成に失敗しました。");
    }
  };

  // タイムラインデータを取得する関数
  async function loadTimeline() {
    try {
      setLoading(true);
      setError(null);
      const data = await SnsApi.fetchTimeline();
      console.log("タイムラインデータ:", data);

      setPosts(data.posts || []);
      setStories(data.stories || []);
    } catch (err) {
      console.error("タイムラインの取得中にエラーが発生しました:", err);
      setError("データの取得に失敗しました。後でもう一度お試しください。");
    } finally {
      setLoading(false);
    }
  }

  onMount(() => {
    loadTimeline();
  });

  const handleLike = async (post: Post) => {
    try {
      // postIdとuserIdを抽出
      const postId = post.id.split("/").pop() || "";
      const username = post.author.userName.split("@")[0];

      if (post.stats.hasLiked) {
        await SnsApi.unlikePost(username, postId);
      } else {
        await SnsApi.likePost(username, postId);
      }

      // いいね操作後にタイムラインを再取得
      await loadTimeline();
    } catch (err) {
      console.error("いいね操作中にエラーが発生しました:", err);
      setError("いいねの操作に失敗しました。");
    }
  };

  const handleCreatePost = async () => {
    try {
      setError(null);
      const mediaArr = postImage() ? [postImage()!] : [];
      await SnsApi.createPost(postText(), mediaArr);

      // 投稿作成後にタイムラインを再取得
      await loadTimeline();

      // 投稿作成後にUIを閉じてフォームをリセット
      setPostText("");
      setPostImage(null);
      setShowCreatePost(false);
    } catch (err) {
      console.error("投稿作成中にエラーが発生しました:", err);
      setError("投稿の作成に失敗しました。");
    }
  };

  return (
    <div class="max-w-xl mx-auto p-4 relative min-h-[80vh]">
      <Show when={!showCreatePost() && !showCreateStory()}>
        <Show when={error()}>
          <div class="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
            {error()}
          </div>
        </Show>

        <Show when={loading()}>
          <div class="flex justify-center items-center my-8">
            <div class="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-blue-500">
            </div>
          </div>
        </Show>

        <div class="mb-4 pb-4 border-b border-gray-200">
          <div class="flex overflow-x-auto scrollbar-hide py-2 lg:scrollbar">
            {/* 自分のストーリーがない場合、作成アイコンを表示 */}
            <Show when={!loading() && !hasMyStory()}>
              <div
                class="flex-shrink-0 mx-2 cursor-pointer"
                onClick={() => setShowCreateStory(true)}
              >
                <div class="relative w-16 h-16 rounded-full border-2 border-gray-300 flex items-center justify-center bg-gray-100">
                  <img
                    src={`data:image/png;base64,${icon()}`}
                    alt="ストーリーを作成"
                    class="w-full h-full rounded-full object-cover"
                  />
                  <div class="absolute bottom-0 right-0 bg-blue-500 rounded-full w-5 h-5 flex items-center justify-center border-2 border-white">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      class="h-3 w-3 text-white"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path
                        fill-rule="evenodd"
                        d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z"
                        clip-rule="evenodd"
                      />
                    </svg>
                  </div>
                </div>
                <div class="text-xs text-center mt-1">ストーリー</div>
              </div>
            </Show>

            <Show
              when={stories().length > 0}
            >
              <For each={stories()}>
                {(story) => <StoryItem story={story} />}
              </For>
            </Show>
          </div>
        </div>

        <div class="flex flex-col gap-6">
          <Show
            when={posts().length > 0}
            fallback={
              <div class="border border-gray-200 rounded-lg overflow-hidden p-8 text-center">
                <div class="text-gray-500 mb-2">投稿はまだありません</div>
                <div class="text-sm text-gray-400">
                  フォローしているユーザーの投稿がここに表示されます
                </div>
              </div>
            }
          >
            <For each={posts()}>
              {(post) => <PostItem post={post} onLike={handleLike} />}
            </For>
          </Show>
        </div>

        <button
          onClick={() => setShowCreatePost(true)}
          class="bottom-6 sticky bg-blue-500 text-white rounded-full w-14 h-14 flex items-center justify-center shadow-lg hover:bg-blue-600 transition-colors left-[360px]"
          aria-label="投稿を作成"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 4v16m8-8H4"
            />
          </svg>
        </button>
      </Show>

      <Show when={showCreatePost()}>
        <CreatePostForm
          onClose={() => setShowCreatePost(false)}
          onSubmit={handleCreatePost}
          postText={postText}
          setPostText={setPostText}
          postImage={postImage}
          setPostImage={setPostImage}
          error={error()}
        />
      </Show>
    </div>
  );
}
