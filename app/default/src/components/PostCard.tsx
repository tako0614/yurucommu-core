import { Link } from "@takos/app-sdk";

export interface Post {
  id: string;
  content: string;
  author: {
    id: string;
    handle: string;
    displayName: string;
    avatar?: string;
  };
  createdAt: string;
  likeCount?: number;
  replyCount?: number;
  liked?: boolean;
  media?: Array<{
    url: string;
    type: "image" | "video";
    alt?: string;
  }>;
}

interface PostCardProps {
  post: Post;
  currentUserId?: string;
  onDelete?: (postId: string) => void;
  onLike?: (postId: string) => void;
}

export function PostCard({ post, currentUserId, onDelete, onLike }: PostCardProps) {
  const isOwner = currentUserId === post.author.id;
  const timeAgo = formatTimeAgo(post.createdAt);

  return (
    <article className="px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-900/50 transition-colors">
      <div className="flex gap-3">
        <Link to={`/@${post.author.handle}`} className="flex-shrink-0">
          {post.author.avatar ? (
            <img
              src={post.author.avatar}
              alt={post.author.displayName}
              className="w-10 h-10 rounded-full object-cover"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
              <span className="text-gray-500 dark:text-gray-400 text-sm font-medium">
                {post.author.displayName.charAt(0).toUpperCase()}
              </span>
            </div>
          )}
        </Link>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 flex-wrap">
            <Link
              to={`/@${post.author.handle}`}
              className="font-semibold hover:underline truncate"
            >
              {post.author.displayName}
            </Link>
            <span className="text-gray-500 dark:text-gray-400 truncate">
              @{post.author.handle}
            </span>
            <span className="text-gray-400 dark:text-gray-500">·</span>
            <time
              className="text-gray-500 dark:text-gray-400 text-sm"
              dateTime={post.createdAt}
            >
              {timeAgo}
            </time>
          </div>

          <div className="mt-1 whitespace-pre-wrap break-words">
            {post.content}
          </div>

          {post.media && post.media.length > 0 && (
            <div className="mt-3 grid gap-2 rounded-xl overflow-hidden">
              {post.media.map((m, i) => (
                m.type === "image" ? (
                  <img
                    key={i}
                    src={m.url}
                    alt={m.alt || ""}
                    className="w-full max-h-96 object-cover rounded-xl"
                  />
                ) : (
                  <video
                    key={i}
                    src={m.url}
                    controls
                    className="w-full max-h-96 rounded-xl"
                  />
                )
              ))}
            </div>
          )}

          <div className="mt-3 flex items-center gap-6 text-gray-500 dark:text-gray-400">
            <button
              type="button"
              className="flex items-center gap-1 hover:text-blue-600 transition-colors"
            >
              <ReplyIcon />
              <span className="text-sm">{post.replyCount || 0}</span>
            </button>

            <button
              type="button"
              onClick={() => onLike?.(post.id)}
              className={`flex items-center gap-1 transition-colors ${
                post.liked ? "text-pink-600" : "hover:text-pink-600"
              }`}
            >
              <HeartIcon filled={post.liked} />
              <span className="text-sm">{post.likeCount || 0}</span>
            </button>

            {isOwner && onDelete && (
              <button
                type="button"
                onClick={() => onDelete(post.id)}
                className="flex items-center gap-1 hover:text-red-600 transition-colors ml-auto"
              >
                <TrashIcon />
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

function ReplyIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
      />
    </svg>
  );
}

function HeartIcon({ filled = false }: { filled?: boolean }) {
  return (
    <svg
      className="w-5 h-5"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
      />
    </svg>
  );
}

function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 7) {
    return date.toLocaleDateString();
  }
  if (days > 0) {
    return `${days}d`;
  }
  if (hours > 0) {
    return `${hours}h`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return "now";
}
