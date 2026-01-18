import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Post, Actor, MediaAttachment } from '../types';
import { fetchPost, fetchReplies, createPost, likePost, unlikePost, deletePost, bookmarkPost, unbookmarkPost } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { formatDateTime } from '../lib/datetime';
import { UserAvatar } from '../components/UserAvatar';
import { PostContent } from '../components/PostContent';
import { HeartIcon, ReplyIcon, BookmarkIcon } from '../components/icons/SocialIcons';
import { InlineErrorBanner } from '../components/InlineErrorBanner';
import { useInlineError } from '../hooks/useInlineError';

interface PostDetailPageProps {
  actor: Actor;
}

const BackIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
  </svg>
);

const TrashIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
  </svg>
);

export function PostDetailPage({ actor }: PostDetailPageProps) {
  const { postId } = useParams<{ postId: string }>();
  const navigate = useNavigate();
  const { t } = useI18n();
  const { error, setError, clearError } = useInlineError();
  const [post, setPost] = useState<Post | null>(null);
  const [replies, setReplies] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [replyContent, setReplyContent] = useState('');
  const [replying, setReplying] = useState(false);

  useEffect(() => {
    if (!postId) return;

    const decodedPostId = decodeURIComponent(postId);
    setLoading(true);
    Promise.all([
      fetchPost(decodedPostId),
      fetchReplies(decodedPostId)
    ]).then(([postData, repliesData]) => {
      setPost(postData);
      setReplies(repliesData);
    }).catch(e => {
      console.error('Failed to load post:', e);
      setError(t('common.error'));
    }).finally(() => {
      setLoading(false);
    });
  }, [postId]);

  const handleLike = async (targetPost: Post, isReply: boolean = false) => {
    try {
      if (targetPost.liked) {
        await unlikePost(targetPost.ap_id);
        if (isReply) {
          setReplies(prev => prev.map(r => r.ap_id === targetPost.ap_id ? { ...r, liked: false, like_count: r.like_count - 1 } : r));
        } else {
          setPost(prev => prev ? { ...prev, liked: false, like_count: prev.like_count - 1 } : null);
        }
      } else {
        await likePost(targetPost.ap_id);
        if (isReply) {
          setReplies(prev => prev.map(r => r.ap_id === targetPost.ap_id ? { ...r, liked: true, like_count: r.like_count + 1 } : r));
        } else {
          setPost(prev => prev ? { ...prev, liked: true, like_count: prev.like_count + 1 } : null);
        }
      }
    } catch (e) {
      console.error('Failed to toggle like:', e);
      setError(t('common.error'));
    }
  };

  const handleReply = async () => {
    if (!replyContent.trim() || replying || !post) return;
    setReplying(true);
    try {
      const newReply = await createPost({
        content: replyContent.trim(),
        in_reply_to: post.ap_id,
      });
      setReplies(prev => [...prev, newReply]);
      setReplyContent('');
      setPost(prev => prev ? { ...prev, reply_count: prev.reply_count + 1 } : null);
    } catch (e) {
      console.error('Failed to reply:', e);
      setError(t('common.error'));
    } finally {
      setReplying(false);
    }
  };

  const handleDelete = async (targetPost: Post, isReply: boolean = false) => {
    if (!confirm('Delete this post?')) return;
    try {
      await deletePost(targetPost.ap_id);
      if (isReply) {
        setReplies(prev => prev.filter(r => r.ap_id !== targetPost.ap_id));
        if (post) {
          setPost({ ...post, reply_count: Math.max(0, post.reply_count - 1) });
        }
      } else {
        navigate(-1);
      }
    } catch (e) {
      console.error('Failed to delete:', e);
      setError(t('common.error'));
    }
  };

  const handleBookmark = async () => {
    if (!post) return;
    try {
      if (post.bookmarked) {
        await unbookmarkPost(post.ap_id);
        setPost({ ...post, bookmarked: false });
      } else {
        await bookmarkPost(post.ap_id);
        setPost({ ...post, bookmarked: true });
      }
    } catch (e) {
      console.error('Failed to toggle bookmark:', e);
      setError(t('common.error'));
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col h-full">
      {error && (
        <InlineErrorBanner message={error} onClose={clearError} />
      )}
        <header className="sticky top-0 bg-black/80 backdrop-blur-sm border-b border-neutral-900 z-10">
          <div className="flex items-center gap-4 px-4 py-3">
            <button onClick={() => navigate(-1)} aria-label="Back" className="p-1 hover:bg-neutral-800 rounded-full">
              <BackIcon />
            </button>
            <h1 className="text-xl font-bold">Post</h1>
          </div>
        </header>
        <div className="p-8 text-center text-neutral-500">{t('common.loading')}</div>
      </div>
    );
  }

  if (!post) {
    return (
      <div className="flex flex-col h-full">
      {error && (
        <InlineErrorBanner message={error} onClose={clearError} />
      )}
        <header className="sticky top-0 bg-black/80 backdrop-blur-sm border-b border-neutral-900 z-10">
          <div className="flex items-center gap-4 px-4 py-3">
            <button onClick={() => navigate(-1)} aria-label="Back" className="p-1 hover:bg-neutral-800 rounded-full">
              <BackIcon />
            </button>
            <h1 className="text-xl font-bold">Post</h1>
          </div>
        </header>
        <div className="p-8 text-center text-neutral-500">Post not found</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {error && (
        <InlineErrorBanner message={error} onClose={clearError} />
      )}
      <header className="sticky top-0 bg-black/80 backdrop-blur-sm border-b border-neutral-900 z-10">
        <div className="flex items-center gap-4 px-4 py-3">
          <button onClick={() => navigate(-1)} aria-label="Back" className="p-1 hover:bg-neutral-800 rounded-full">
            <BackIcon />
          </button>
          <h1 className="text-xl font-bold">Post</h1>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        {/* Main Post */}
        <div className="px-4 py-4 border-b border-neutral-900">
          <div className="flex gap-3">
            <Link to={`/profile/${encodeURIComponent(post.author.ap_id)}`}>
              <UserAvatar
                avatarUrl={post.author.icon_url}
                name={post.author.name || post.author.preferred_username}
                size={48}
              />
            </Link>
            <div className="flex-1">
              <Link to={`/profile/${encodeURIComponent(post.author.ap_id)}`} className="font-bold text-white hover:underline">
                {post.author.name || post.author.preferred_username}
              </Link>
              <div className="text-neutral-500">@{post.author.username}</div>
            </div>
            {post.author.ap_id === actor.ap_id && (
              <button
                onClick={() => handleDelete(post)}
                className="p-2 text-neutral-500 hover:text-red-500 hover:bg-red-500/10 rounded-full transition-colors"
              >
                <TrashIcon />
              </button>
            )}
          </div>
          <PostContent
            content={post.content}
            className="text-lg text-neutral-100 mt-3"
          />
          {/* Post Images */}
          {post.attachments.length > 0 && (
            <div className={`mt-3 grid gap-1 rounded-xl overflow-hidden ${
              post.attachments.length === 1 ? 'grid-cols-1' :
              post.attachments.length === 2 ? 'grid-cols-2' :
              post.attachments.length === 3 ? 'grid-cols-2' : 'grid-cols-2'
            }`}>
              {post.attachments.map((m, idx) => (
                <img
                  key={m.r2_key}
                  src={`/media/${m.r2_key}`}
                  alt=""
                  className={`w-full object-cover ${
                    post.attachments.length === 1 ? 'max-h-[500px]' :
                    post.attachments.length === 3 && idx === 0 ? 'row-span-2 h-full' : 'h-48'
                  }`}
                />
              ))}
            </div>
          )}
          <div className="text-neutral-500 text-sm mt-3">
            {formatDateTime(post.published)}
          </div>
          <div className="flex items-center gap-6 mt-3 pt-3 border-t border-neutral-800">
            <div className="text-sm">
              <span className="font-bold text-white">{post.reply_count}</span>
              <span className="text-neutral-500 ml-1">Replies</span>
            </div>
            {post.author.ap_id === actor.ap_id && (
              <div className="text-sm">
                <span className="font-bold text-white">{post.like_count}</span>
                <span className="text-neutral-500 ml-1">Likes</span>
              </div>
            )}
          </div>
          <div className="flex items-center justify-around mt-3 pt-3 border-t border-neutral-800">
            <button aria-label="Reply" className="flex items-center gap-2 p-2 text-neutral-500 hover:text-blue-500 transition-colors">
              <ReplyIcon />
            </button>
            <button
              onClick={() => handleLike(post)}
              aria-label={post.liked ? 'Unlike' : 'Like'}
              aria-pressed={post.liked}
              className={`flex items-center gap-2 p-2 transition-colors ${
                post.liked ? 'text-pink-500' : 'text-neutral-500 hover:text-pink-500'
              }`}
            >
              <HeartIcon filled={post.liked || false} />
            </button>
            <button
              onClick={handleBookmark}
              aria-label={post.bookmarked ? 'Remove bookmark' : 'Bookmark'}
              aria-pressed={post.bookmarked}
              className={`flex items-center gap-2 p-2 transition-colors ${
                post.bookmarked ? 'text-blue-500' : 'text-neutral-500 hover:text-blue-500'
              }`}
            >
              <BookmarkIcon filled={post.bookmarked || false} />
            </button>
          </div>
        </div>

        {/* Reply Composer */}
        <div className="px-4 py-3 border-b border-neutral-900">
          <div className="flex gap-3">
            <UserAvatar
              avatarUrl={actor.icon_url}
              name={actor.name || actor.preferred_username}
              size={40}
            />
            <div className="flex-1">
              <textarea
                value={replyContent}
                onChange={e => setReplyContent(e.target.value)}
                placeholder="Post a reply"
                className="w-full bg-transparent text-white placeholder-neutral-500 resize-none outline-none"
                rows={2}
              />
              <div className="flex justify-end">
                <button
                  onClick={handleReply}
                  disabled={!replyContent.trim() || replying}
                  className="px-4 py-1.5 bg-blue-500 hover:bg-blue-600 disabled:bg-neutral-800 disabled:text-neutral-600 rounded-full text-sm font-bold transition-colors"
                >
                  Reply
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Replies */}
        {replies.map(reply => (
          <div key={reply.ap_id} className="flex gap-3 px-4 py-3 border-b border-neutral-900 hover:bg-neutral-900/30 transition-colors">
            <Link to={`/profile/${encodeURIComponent(reply.author.ap_id)}`}>
              <UserAvatar
                avatarUrl={reply.author.icon_url}
                name={reply.author.name || reply.author.preferred_username}
                size={40}
              />
            </Link>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <Link to={`/profile/${encodeURIComponent(reply.author.ap_id)}`} className="font-bold text-white truncate hover:underline">
                  {reply.author.name || reply.author.preferred_username}
                </Link>
                <span className="text-neutral-500 truncate">@{reply.author.username}</span>
                <span className="text-neutral-500">·</span>
                <span className="text-neutral-500 text-sm">{formatDateTime(reply.published)}</span>
                {reply.author.ap_id === actor.ap_id && (
                  <button
                    onClick={() => handleDelete(reply, true)}
                    aria-label="Delete reply"
                    className="ml-auto p-1 text-neutral-500 hover:text-red-500 hover:bg-red-500/10 rounded-full transition-colors"
                  >
                    <TrashIcon />
                  </button>
                )}
              </div>
              <PostContent
                content={reply.content}
                className="text-[15px] text-neutral-200 mt-1"
              />
              <div className="flex items-center gap-6 mt-2">
                <button
                  onClick={() => handleLike(reply, true)}
                  aria-label={reply.liked ? 'Unlike reply' : 'Like reply'}
                  aria-pressed={reply.liked}
                  className={`flex items-center gap-2 transition-colors ${
                    reply.liked ? 'text-pink-500' : 'text-neutral-500 hover:text-pink-500'
                  }`}
                >
                  <HeartIcon filled={reply.liked || false} />
                  {reply.author.ap_id === actor.ap_id && reply.like_count > 0 && (
                    <span className="text-sm">{reply.like_count}</span>
                  )}
                </button>
              </div>
            </div>
          </div>
        ))}

        {replies.length === 0 && (
          <div className="p-8 text-center text-neutral-500">
            No replies yet
          </div>
        )}
      </div>
    </div>
  );
}

export default PostDetailPage;
