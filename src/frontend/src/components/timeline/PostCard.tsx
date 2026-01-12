import { Link } from 'react-router-dom';
import { Post } from '../../types';
import { UserAvatar } from '../UserAvatar';

interface PostCardProps {
  post: Post;
  onLike: () => void;
  onDelete?: () => void;
  onReply?: () => void;
}

// SVG Icons
const CommentIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
  </svg>
);

const RepostIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
  </svg>
);

const HeartIcon = ({ filled }: { filled: boolean }) => (
  <svg className="w-5 h-5" fill={filled ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
  </svg>
);

const BookmarkIcon = ({ filled }: { filled: boolean }) => (
  <svg className="w-5 h-5" fill={filled ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
  </svg>
);

const TrashIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
  </svg>
);

export function PostCard({ post, onLike, onDelete, onReply }: PostCardProps) {
  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'now';
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 7) return `${diffDays}d`;
    return date.toLocaleDateString();
  };

  return (
    <article className="px-4 py-3 border-b border-neutral-900 hover:bg-neutral-900/30 transition-colors">
      <div className="flex gap-3">
        {/* Avatar */}
        <Link to={`/profile/${post.member_id}`} className="shrink-0">
          <UserAvatar
            avatarUrl={post.avatar_url}
            name={post.display_name || post.username}
            size={40}
          />
        </Link>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Header */}
          <div className="flex items-center gap-1 text-[15px]">
            <Link to={`/profile/${post.member_id}`} className="font-bold text-white hover:underline truncate">
              {post.display_name || post.username}
            </Link>
            <span className="text-neutral-500 truncate">@{post.username}</span>
            <span className="text-neutral-600">·</span>
            <time className="text-neutral-500 shrink-0">
              {formatTime(post.created_at)}
            </time>
          </div>

          {/* Content */}
          <p className="mt-1 text-[15px] text-white whitespace-pre-wrap break-words leading-relaxed">
            {post.content}
          </p>

          {/* Actions */}
          <div className="flex items-center gap-1 mt-3 -ml-2">
            {/* Reply */}
            <button
              onClick={onReply}
              className="flex items-center gap-1 p-2 text-neutral-500 hover:text-blue-400 hover:bg-blue-400/10 rounded-full transition-colors group"
            >
              <CommentIcon />
              {post.reply_count > 0 && <span className="text-sm">{post.reply_count}</span>}
            </button>

            {/* Repost */}
            <button className="flex items-center gap-1 p-2 text-neutral-500 hover:text-green-400 hover:bg-green-400/10 rounded-full transition-colors group">
              <RepostIcon />
              {post.repost_count > 0 && <span className="text-sm">{post.repost_count}</span>}
            </button>

            {/* Like */}
            <button
              onClick={onLike}
              className={`flex items-center gap-1 p-2 rounded-full transition-colors ${
                post.liked
                  ? 'text-pink-500'
                  : 'text-neutral-500 hover:text-pink-500 hover:bg-pink-500/10'
              }`}
            >
              <HeartIcon filled={!!post.liked} />
              {post.like_count > 0 && <span className="text-sm">{post.like_count}</span>}
            </button>

            {/* Bookmark */}
            <button
              className={`flex items-center p-2 rounded-full transition-colors ${
                post.bookmarked
                  ? 'text-blue-400'
                  : 'text-neutral-500 hover:text-blue-400 hover:bg-blue-400/10'
              }`}
            >
              <BookmarkIcon filled={!!post.bookmarked} />
            </button>

            {/* Delete (only for own posts) */}
            {onDelete && (
              <button
                onClick={onDelete}
                className="flex items-center p-2 text-neutral-500 hover:text-red-500 hover:bg-red-500/10 rounded-full transition-colors ml-auto"
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
