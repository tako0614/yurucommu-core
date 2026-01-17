import { Link } from 'react-router-dom';
import type { Actor, Post } from '../../types';
import { formatRelativeTime } from '../../lib/datetime';
import { UserAvatar } from '../UserAvatar';
import { PostContent } from '../PostContent';
import { HeartIcon, ReplyIcon } from '../icons/SocialIcons';

type Translate = (key: string) => string;

type ProfileTab = 'posts' | 'likes';

interface ProfilePostsSectionProps {
  activeTab: ProfileTab;
  onChangeTab: (tab: ProfileTab) => void;
  posts: Post[];
  actorApId: string;
  t: Translate;
  onLike: (post: Post) => void;
}

export function ProfilePostsSection({
  activeTab,
  onChangeTab,
  posts,
  actorApId,
  t,
  onLike,
}: ProfilePostsSectionProps) {
  return (
    <>
      {/* Tabs */}
      <div className="border-b border-neutral-900 flex">
        <button
          onClick={() => onChangeTab('posts')}
          className={`flex-1 py-4 text-center font-bold transition-colors relative ${
            activeTab === 'posts' ? 'text-white' : 'text-neutral-500 hover:bg-neutral-900/50'
          }`}
        >
          {t('profile.posts')}
          {activeTab === 'posts' && (
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-16 h-1 bg-blue-500 rounded-full" />
          )}
        </button>
        <button
          onClick={() => onChangeTab('likes')}
          className={`flex-1 py-4 text-center font-bold transition-colors relative ${
            activeTab === 'likes' ? 'text-white' : 'text-neutral-500 hover:bg-neutral-900/50'
          }`}
        >
          {t('profile.likes')}
          {activeTab === 'likes' && (
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-16 h-1 bg-blue-500 rounded-full" />
          )}
        </button>
      </div>

      {/* Posts */}
      {activeTab === 'posts' && (
        <>
          {posts.length === 0 ? (
            <div className="p-8 text-center text-neutral-500">{t('timeline.empty')}</div>
          ) : (
            posts.map((post) => (
              <ProfilePostItem
                key={post.ap_id}
                post={post}
                actorApId={actorApId}
                onLike={onLike}
              />
            ))
          )}
        </>
      )}

      {/* Likes Tab */}
      {activeTab === 'likes' && (
        <div className="p-8 text-center text-neutral-500">{t('profile.noLikes')}</div>
      )}
    </>
  );
}

interface ProfilePostItemProps {
  post: Post;
  actorApId: string;
  onLike: (post: Post) => void;
}

function ProfilePostItem({ post, actorApId, onLike }: ProfilePostItemProps) {
  return (
    <div className="flex gap-3 px-4 py-3 border-b border-neutral-900 hover:bg-neutral-900/30 transition-colors">
      <Link to={`/profile/${encodeURIComponent(post.author.ap_id)}`}>
        <UserAvatar
          avatarUrl={post.author.icon_url}
          name={post.author.name || post.author.preferred_username}
          size={48}
        />
      </Link>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <Link
            to={`/profile/${encodeURIComponent(post.author.ap_id)}`}
            className="font-bold text-white truncate hover:underline"
          >
            {post.author.name || post.author.preferred_username}
          </Link>
          <span className="text-neutral-500 truncate">@{post.author.username}</span>
          <span className="text-neutral-500">・</span>
          <span className="text-neutral-500 text-sm">{formatRelativeTime(post.published)}</span>
        </div>
        <PostContent content={post.content} className="text-[15px] text-neutral-200 mt-1" />
        {/* Actions */}
        <div className="flex items-center gap-6 mt-3">
          <button aria-label="Reply" className="flex items-center gap-2 text-neutral-500 hover:text-blue-500 transition-colors">
            <ReplyIcon />
            <span className="text-sm">{post.reply_count || ''}</span>
          </button>
          <button
            onClick={() => onLike(post)}
            aria-label={post.liked ? 'Unlike' : 'Like'}
            aria-pressed={post.liked}
            className={`flex items-center gap-2 transition-colors ${
              post.liked ? 'text-pink-500' : 'text-neutral-500 hover:text-pink-500'
            }`}
          >
            <HeartIcon filled={post.liked || false} />
            {post.author.ap_id === actorApId && post.like_count > 0 && (
              <span className="text-sm">{post.like_count}</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
