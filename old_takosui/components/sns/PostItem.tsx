import { Post } from "../../types/sns";

type PostItemProps = {
  post: Post;
  onLike: (post: Post) => void;
};

export default function PostItem(props: PostItemProps) {
  const { post, onLike } = props;

  return (
    <div class="border border-gray-200 rounded-lg overflow-hidden">
      <div class="flex justify-between items-center p-3 border-b border-gray-100">
        <div class="flex items-center gap-2.5">
          <img
            src={post.author.avatar || "https://placehold.jp/50x50.png"}
            alt={post.author.userName}
            class="w-10 h-10 rounded-full"
          />
          <div>
            <div class="flex items-center gap-1">
              <span class="font-semibold text-sm">
                {post.author.userName.split("@")[0]}
              </span>
              <span class="text-xs text-gray-500">
                @{post.author.domain}
              </span>
            </div>
            <span class="text-xs text-gray-500">
              {new Date(post.createdAt).toLocaleString()}
            </span>
          </div>
        </div>
        <div class="text-xl text-gray-500">⋯</div>
      </div>

      {post.media && post.media.length > 0 && (
        <div class="w-full">
          <img
            src={post.media[0].url}
            alt="投稿画像"
            class="w-full h-auto rounded-lg"
          />
        </div>
      )}
      <div class="px-4 py-3 text-sm">{post.content}</div>
      <div class="flex justify-between p-3 text-gray-500 border-t border-gray-100">
        <button
          class="flex items-center gap-1.5 hover:text-red-500"
          onClick={() => onLike(post)}
        >
          <span class="text-xl">
            {post.stats.hasLiked ? "❤️" : "🤍"}
          </span>
          <span>{post.stats.likes}</span>
        </button>
      </div>
    </div>
  );
}
