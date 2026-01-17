import { Link } from 'react-router-dom';
import type { Post } from '../../types';
import { formatRelativeTime } from '../../lib/datetime';
import { UserAvatar } from '../UserAvatar';
import { PostContent } from '../PostContent';
import { HeartIcon, ReplyIcon, BookmarkIcon, RepostIcon } from '../icons/SocialIcons';

interface TimelinePostItemProps {
  post: Post;
  onReply: (post: Post) => void;
  onRepost: (post: Post) => void;
  onLike: (post: Post) => void;
  onBookmark: (post: Post) => void;
}

export function TimelinePostItem({
  post,
  onReply,
  onRepost,
  onLike,
  onBookmark,
}: TimelinePostItemProps) {
  return (
    <div className="flex gap-3 px-4 py-3 border-b border-neutral-900 hover:bg-neutral-900/30 transition-colors">
      <Link to={`/profile/${encodeURIComponent(post.author.ap_id)}`}>
        <UserAvatar avatarUrl={post.author.icon_url} name={post.author.name || post.author.username} size={48} />
      </Link>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <Link
            to={`/profile/${encodeURIComponent(post.author.ap_id)}`}
            className="font-bold text-white truncate hover:underline"
          >
            {post.author.name || post.author.username}
          </Link>
          <span className="text-neutral-500 truncate">@{post.author.username}</span>
          <span className="text-neutral-500">ÅE</span>
          <span className="text-neutral-500 text-sm">{formatRelativeTime(post.published)}</span>
        </div>
        <Link to={`/post/${encodeURIComponent(post.ap_id)}`} className="block">
          <PostContent content={post.content} className="text-[15px] text-neutral-200 mt-1" />
          {post.attachments && post.attachments.length > 0 && (
            <div
              className={`mt-3 grid gap-1 rounded-xl overflow-hidden ${
                post.attachments.length === 1 ? 'grid-cols-1' : 'grid-cols-2'
              }`}
            >
              {post.attachments.map((m, idx) => (
                <img key={idx} src={`/media/${m.r2_key}`} alt="" className="w-full object-cover max-h-96" />
              ))}
            </div>
          )}
        </Link>
        <div className="flex items-center gap-6 mt-3">
          <button
            onClick={() => onReply(post)}
            aria-label="Reply"
            className="flex items-center gap-2 text-neutral-500 hover:text-blue-500 transition-colors"
          >
            <ReplyIcon />
            <span className="text-sm">{post.reply_count || ''}</span>
          </button>
          <button
            onClick={() => onRepost(post)}
            aria-label={post.reposted ? 'Undo repost' : 'Repost'}
            aria-pressed={post.reposted}
            className={`flex items-center gap-2 transition-colors ${
              post.reposted ? 'text-green-500' : 'text-neutral-500 hover:text-green-500'
            }`}
          >
            <RepostIcon filled={post.reposted} />
            {post.announce_count > 0 && <span className="text-sm">{post.announce_count}</span>}
          </button>
          <button
            onClick={() => onLike(post)}
            aria-label={post.liked ? 'Unlike' : 'Like'}
            aria-pressed={post.liked}
            className={`flex items-center gap-2 transition-colors ${
              post.liked ? 'text-pink-500' : 'text-neutral-500 hover:text-pink-500'
            }`}
          >
            <HeartIcon filled={post.liked} />
            {post.like_count > 0 && <span className="text-sm">{post.like_count}</span>}
          </button>
          <button
            onClick={() => onBookmark(post)}
            aria-label={post.bookmarked ? 'Remove bookmark' : 'Bookmark'}
            aria-pressed={post.bookmarked}
            className={`flex items-center gap-2 transition-colors ${
              post.bookmarked ? 'text-blue-500' : 'text-neutral-500 hover:text-blue-500'
            }`}
          >
            <BookmarkIcon filled={post.bookmarked} />
          </button>
        </div>
      </div>
    </div>
  );
}
