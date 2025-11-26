import { useParams } from "@solidjs/router";
import { Show, createMemo, createResource, createSignal } from "solid-js";
import { api } from "../lib/api";
import PostCard from "../components/PostCard";

export default function PostDetail() {
  const params = useParams();
  const postId = createMemo(() => params.id);
  const [deleted, setDeleted] = createSignal(false);
  const [post, { mutate: setPost }] = createResource(postId, async (id) => {
    if (!id) throw new Error("post id is missing");
    const found = await api(`/posts/${id}`);
    return found;
  });

  const handlePostUpdated = (updated: any) => {
    setPost((prev) => {
      if (!prev || prev.id !== updated?.id) return prev;
      return { ...prev, ...updated };
    });
  };

  const handlePostDeleted = () => {
    setDeleted(true);
    setPost(undefined);
  };

  return (
    <div class="px-3 sm:px-4 pt-14">
      <div class="max-w-[680px] mx-auto">
        <Show
          when={!post.error && post()}
          fallback={
            <div class="bg-white dark:bg-neutral-900 border hairline rounded-md p-6 text-center text-muted">
              {deleted()
                ? "投稿は削除されました"
                : post.error
                  ? "投稿が見つかりませんでした"
                  : "読み込み中…"}
            </div>
          }
        >
          {(data) => (
            <PostCard
              post={data()}
              defaultShowComments
              onUpdated={handlePostUpdated}
              onDeleted={handlePostDeleted}
            />
          )}
        </Show>
      </div>
    </div>
  );
}
