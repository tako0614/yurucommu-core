import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Member, MemberProfile, Post } from '../types';
import {
  fetchMemberProfile,
  fetchMemberPosts,
  fetchMemberLikes,
  followMember,
  unfollowMember,
  likePost,
  unlikePost,
  repostPost,
  unrepostPost,
  updateProfile,
  blockUser,
  unblockUser,
  muteUser,
  unmuteUser,
} from '../lib/api';
import { useI18n } from '../lib/i18n';
import { UserAvatar } from '../components/UserAvatar';
import { PostContent } from '../components/PostContent';

interface ProfilePageProps {
  currentMember: Member;
}

// Icons
const HeartIcon = ({ filled }: { filled: boolean }) => (
  <svg className="w-5 h-5" fill={filled ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
  </svg>
);

const RepostIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
  </svg>
);

const ReplyIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
  </svg>
);

const BackIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
  </svg>
);

const CalendarIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
  </svg>
);

const CloseIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const MoreIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z" />
  </svg>
);

export function ProfilePage({ currentMember }: ProfilePageProps) {
  const { t } = useI18n();
  const { memberId } = useParams<{ memberId?: string }>();
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [likedPosts, setLikedPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [likesLoading, setLikesLoading] = useState(false);
  const [likesLoaded, setLikesLoaded] = useState(false);
  const [following, setFollowing] = useState(false);
  const [activeTab, setActiveTab] = useState<'posts' | 'likes'>('posts');
  const [showEditModal, setShowEditModal] = useState(false);
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editBio, setEditBio] = useState('');
  const [saving, setSaving] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  // Use current member if no memberId in URL
  const targetMemberId = memberId || currentMember.id;
  const isOwnProfile = targetMemberId === currentMember.id;

  const loadProfile = useCallback(async () => {
    try {
      const [profileData, postsData] = await Promise.all([
        fetchMemberProfile(targetMemberId),
        fetchMemberPosts(targetMemberId, { limit: 50 }),
      ]);
      setProfile(profileData.member);
      setPosts(postsData.posts || []);
      setFollowing(profileData.member.is_following || false);
    } catch (e) {
      console.error('Failed to load profile:', e);
    } finally {
      setLoading(false);
    }
  }, [targetMemberId]);

  useEffect(() => {
    setLoading(true);
    setLikesLoaded(false);
    loadProfile();
  }, [loadProfile]);

  // Load likes when tab switches to likes
  useEffect(() => {
    if (activeTab === 'likes' && !likesLoaded && !likesLoading) {
      setLikesLoading(true);
      fetchMemberLikes(targetMemberId, { limit: 50 })
        .then(data => {
          setLikedPosts(data.posts || []);
          setLikesLoaded(true);
        })
        .catch(e => console.error('Failed to load likes:', e))
        .finally(() => setLikesLoading(false));
    }
  }, [activeTab, targetMemberId, likesLoaded, likesLoading]);

  const handleFollow = async () => {
    if (!profile) return;
    try {
      if (following) {
        await unfollowMember(profile.id);
        setFollowing(false);
        setProfile(prev => prev ? { ...prev, follower_count: prev.follower_count - 1 } : null);
      } else {
        await followMember(profile.id);
        setFollowing(true);
        setProfile(prev => prev ? { ...prev, follower_count: prev.follower_count + 1 } : null);
      }
    } catch (e) {
      console.error('Failed to toggle follow:', e);
    }
  };

  const handleLike = async (post: Post) => {
    try {
      if (post.liked) {
        await unlikePost(post.id);
        const updateFn = (p: Post) => p.id === post.id ? { ...p, liked: false, like_count: p.like_count - 1 } : p;
        setPosts(prev => prev.map(updateFn));
        setLikedPosts(prev => prev.map(updateFn));
      } else {
        await likePost(post.id);
        const updateFn = (p: Post) => p.id === post.id ? { ...p, liked: true, like_count: p.like_count + 1 } : p;
        setPosts(prev => prev.map(updateFn));
        setLikedPosts(prev => prev.map(updateFn));
      }
    } catch (e) {
      console.error('Failed to toggle like:', e);
    }
  };

  const handleRepost = async (post: Post) => {
    try {
      if (post.reposted) {
        await unrepostPost(post.id);
        const updateFn = (p: Post) => p.id === post.id ? { ...p, reposted: false, repost_count: p.repost_count - 1 } : p;
        setPosts(prev => prev.map(updateFn));
        setLikedPosts(prev => prev.map(updateFn));
      } else {
        await repostPost(post.id);
        const updateFn = (p: Post) => p.id === post.id ? { ...p, reposted: true, repost_count: p.repost_count + 1 } : p;
        setPosts(prev => prev.map(updateFn));
        setLikedPosts(prev => prev.map(updateFn));
      }
    } catch (e) {
      console.error('Failed to toggle repost:', e);
    }
  };

  const openEditModal = () => {
    if (profile) {
      setEditDisplayName(profile.display_name || '');
      setEditBio(profile.bio || '');
      setShowEditModal(true);
    }
  };

  const handleSaveProfile = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await updateProfile({
        display_name: editDisplayName.trim() || undefined,
        bio: editBio.trim() || undefined,
      });
      setProfile(prev => prev ? {
        ...prev,
        display_name: editDisplayName.trim() || prev.username,
        bio: editBio.trim(),
      } : null);
      setShowEditModal(false);
    } catch (e) {
      console.error('Failed to update profile:', e);
    } finally {
      setSaving(false);
    }
  };

  const handleBlock = async () => {
    if (!profile) return;
    try {
      if (isBlocked) {
        await unblockUser(profile.id);
        setIsBlocked(false);
      } else {
        await blockUser(profile.id);
        setIsBlocked(true);
        setFollowing(false);
      }
      setShowMenu(false);
    } catch (e) {
      console.error('Failed to toggle block:', e);
    }
  };

  const handleMute = async () => {
    if (!profile) return;
    try {
      if (isMuted) {
        await unmuteUser(profile.id);
        setIsMuted(false);
      } else {
        await muteUser(profile.id);
        setIsMuted(true);
      }
      setShowMenu(false);
    } catch (e) {
      console.error('Failed to toggle mute:', e);
    }
  };

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

  const formatJoinDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
  };

  if (loading) {
    return (
      <div className="flex flex-col h-full">
        <header className="sticky top-0 bg-black/80 backdrop-blur-sm border-b border-neutral-900 z-10">
          <div className="flex items-center gap-4 px-4 py-3">
            <Link to="/" className="p-2 -ml-2 hover:bg-neutral-900 rounded-full">
              <BackIcon />
            </Link>
            <h1 className="text-xl font-bold">{t('nav.profile')}</h1>
          </div>
        </header>
        <div className="p-8 text-center text-neutral-500">{t('common.loading')}</div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex flex-col h-full">
        <header className="sticky top-0 bg-black/80 backdrop-blur-sm border-b border-neutral-900 z-10">
          <div className="flex items-center gap-4 px-4 py-3">
            <Link to="/" className="p-2 -ml-2 hover:bg-neutral-900 rounded-full">
              <BackIcon />
            </Link>
            <h1 className="text-xl font-bold">{t('nav.profile')}</h1>
          </div>
        </header>
        <div className="p-8 text-center text-neutral-500">{t('common.error')}</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="sticky top-0 bg-black/80 backdrop-blur-sm border-b border-neutral-900 z-10">
        <div className="flex items-center gap-4 px-4 py-3">
          {memberId && (
            <Link to="/" className="p-2 -ml-2 hover:bg-neutral-900 rounded-full">
              <BackIcon />
            </Link>
          )}
          <div>
            <h1 className="text-xl font-bold">
              {profile.display_name || profile.username}
            </h1>
            <p className="text-sm text-neutral-500">{profile.post_count} {t('profile.posts')}</p>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        {/* Header Image */}
        <div className="h-32 md:h-48 bg-neutral-800 relative">
          {profile.header_url && (
            <img
              src={profile.header_url}
              alt=""
              className="w-full h-full object-cover"
            />
          )}
        </div>

        {/* Profile Info */}
        <div className="px-4 pb-4 relative">
          {/* Avatar */}
          <div className="absolute -top-16 left-4">
            <div className="w-32 h-32 rounded-full border-4 border-black overflow-hidden bg-neutral-800">
              <UserAvatar
                avatarUrl={profile.avatar_url}
                name={profile.display_name || profile.username}
                size={128}
              />
            </div>
          </div>

          {/* Follow Button & Menu */}
          <div className="flex justify-end pt-3 pb-12 gap-2">
            {!isOwnProfile && (
              <>
                <div className="relative">
                  <button
                    onClick={() => setShowMenu(!showMenu)}
                    className="p-2 border border-neutral-600 rounded-full hover:bg-neutral-900 transition-colors"
                  >
                    <MoreIcon />
                  </button>
                  {showMenu && (
                    <div className="absolute right-0 top-full mt-1 bg-neutral-900 rounded-xl shadow-lg py-1 min-w-[180px] z-20 border border-neutral-800">
                      <button
                        onClick={handleMute}
                        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-neutral-800 transition-colors"
                      >
                        {isMuted ? 'ミュート解除' : 'ミュートする'}
                      </button>
                      <button
                        onClick={handleBlock}
                        className="w-full flex items-center gap-3 px-4 py-3 text-left text-red-500 hover:bg-neutral-800 transition-colors"
                      >
                        {isBlocked ? 'ブロック解除' : 'ブロックする'}
                      </button>
                    </div>
                  )}
                </div>
                <button
                  onClick={handleFollow}
                  disabled={isBlocked}
                  className={`px-4 py-2 rounded-full font-bold transition-colors ${
                    following
                      ? 'bg-transparent border border-neutral-600 text-white hover:border-red-500 hover:text-red-500'
                      : 'bg-white text-black hover:bg-neutral-200'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {following ? t('profile.unfollow') : t('profile.follow')}
                </button>
              </>
            )}
            {isOwnProfile && (
              <button
                onClick={openEditModal}
                className="px-4 py-2 rounded-full font-bold border border-neutral-600 text-white hover:bg-neutral-900 transition-colors"
              >
                {t('profile.editProfile')}
              </button>
            )}
          </div>

          {/* Name & Username */}
          <div className="mb-3">
            <div className="text-xl font-bold text-white">
              {profile.display_name || profile.username}
            </div>
            <div className="text-neutral-500">@{profile.username}</div>
          </div>

          {/* Bio */}
          {profile.bio && (
            <p className="text-neutral-200 mb-3 whitespace-pre-wrap">{profile.bio}</p>
          )}

          {/* Join Date */}
          <div className="flex items-center gap-1 text-neutral-500 text-sm mb-3">
            <CalendarIcon />
            <span>Joined {formatJoinDate(profile.created_at)}</span>
          </div>

          {/* Follow Stats */}
          <div className="flex gap-4 text-sm">
            <span className="hover:underline cursor-pointer">
              <span className="font-bold text-white">{profile.following_count}</span>
              <span className="text-neutral-500 ml-1">{t('profile.following')}</span>
            </span>
            <span className="hover:underline cursor-pointer">
              <span className="font-bold text-white">{profile.follower_count}</span>
              <span className="text-neutral-500 ml-1">{t('profile.followers')}</span>
            </span>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-neutral-900 flex">
          <button
            onClick={() => setActiveTab('posts')}
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
            onClick={() => setActiveTab('likes')}
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
              posts.map(post => (
                <div
                  key={post.id}
                  className="flex gap-3 px-4 py-3 border-b border-neutral-900 hover:bg-neutral-900/30 transition-colors"
                >
                  <Link to={`/profile/${post.member_id}`}>
                    <UserAvatar
                      avatarUrl={post.avatar_url}
                      name={post.display_name || post.username}
                      size={48}
                    />
                  </Link>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <Link to={`/profile/${post.member_id}`} className="font-bold text-white truncate hover:underline">
                        {post.display_name || post.username}
                      </Link>
                      <span className="text-neutral-500 truncate">@{post.username}</span>
                      <span className="text-neutral-500">·</span>
                      <span className="text-neutral-500 text-sm">{formatTime(post.created_at)}</span>
                    </div>
                    <PostContent
                      content={post.content}
                      className="text-[15px] text-neutral-200 mt-1"
                    />
                    {/* Actions */}
                    <div className="flex items-center gap-6 mt-3">
                      <button className="flex items-center gap-2 text-neutral-500 hover:text-blue-500 transition-colors">
                        <ReplyIcon />
                        <span className="text-sm">{post.reply_count || ''}</span>
                      </button>
                      <button
                        onClick={() => handleRepost(post)}
                        className={`flex items-center gap-2 transition-colors ${
                          post.reposted ? 'text-green-500' : 'text-neutral-500 hover:text-green-500'
                        }`}
                      >
                        <RepostIcon />
                        <span className="text-sm">{post.repost_count || ''}</span>
                      </button>
                      <button
                        onClick={() => handleLike(post)}
                        className={`flex items-center gap-2 transition-colors ${
                          post.liked ? 'text-pink-500' : 'text-neutral-500 hover:text-pink-500'
                        }`}
                      >
                        <HeartIcon filled={post.liked || false} />
                        {post.member_id === currentMember.id && post.like_count > 0 && (
                          <span className="text-sm">{post.like_count}</span>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </>
        )}

        {/* Likes Tab */}
        {activeTab === 'likes' && (
          <>
            {likesLoading ? (
              <div className="p-8 text-center text-neutral-500">{t('common.loading')}</div>
            ) : likedPosts.length === 0 ? (
              <div className="p-8 text-center text-neutral-500">{t('profile.noLikes')}</div>
            ) : (
              likedPosts.map(post => (
                <div
                  key={post.id}
                  className="flex gap-3 px-4 py-3 border-b border-neutral-900 hover:bg-neutral-900/30 transition-colors"
                >
                  <Link to={`/profile/${post.member_id}`}>
                    <UserAvatar
                      avatarUrl={post.avatar_url}
                      name={post.display_name || post.username}
                      size={48}
                    />
                  </Link>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <Link to={`/profile/${post.member_id}`} className="font-bold text-white truncate hover:underline">
                        {post.display_name || post.username}
                      </Link>
                      <span className="text-neutral-500 truncate">@{post.username}</span>
                      <span className="text-neutral-500">·</span>
                      <span className="text-neutral-500 text-sm">{formatTime(post.created_at)}</span>
                    </div>
                    <Link to={`/post/${post.id}`}>
                      <PostContent
                        content={post.content}
                        className="text-[15px] text-neutral-200 mt-1"
                      />
                    </Link>
                    <div className="flex items-center gap-6 mt-3">
                      <button className="flex items-center gap-2 text-neutral-500 hover:text-blue-500 transition-colors">
                        <ReplyIcon />
                        <span className="text-sm">{post.reply_count || ''}</span>
                      </button>
                      <button
                        onClick={() => handleRepost(post)}
                        className={`flex items-center gap-2 transition-colors ${
                          post.reposted ? 'text-green-500' : 'text-neutral-500 hover:text-green-500'
                        }`}
                      >
                        <RepostIcon />
                        <span className="text-sm">{post.repost_count || ''}</span>
                      </button>
                      <button
                        onClick={() => handleLike(post)}
                        className={`flex items-center gap-2 transition-colors ${
                          post.liked ? 'text-pink-500' : 'text-neutral-500 hover:text-pink-500'
                        }`}
                      >
                        <HeartIcon filled={post.liked || false} />
                        {post.member_id === currentMember.id && post.like_count > 0 && (
                          <span className="text-sm">{post.like_count}</span>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </>
        )}
      </div>

      {/* Edit Profile Modal */}
      {showEditModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-neutral-900 rounded-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
              <div className="flex items-center gap-4">
                <button
                  onClick={() => setShowEditModal(false)}
                  className="p-1 hover:bg-neutral-800 rounded-full transition-colors"
                >
                  <CloseIcon />
                </button>
                <h2 className="text-lg font-bold">{t('profile.editProfile')}</h2>
              </div>
              <button
                onClick={handleSaveProfile}
                disabled={saving}
                className="px-4 py-1.5 bg-white text-black rounded-full font-bold text-sm hover:bg-neutral-200 disabled:bg-neutral-600 transition-colors"
              >
                {saving ? t('common.loading') : t('common.save')}
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-sm text-neutral-400 mb-1">名前</label>
                <input
                  type="text"
                  value={editDisplayName}
                  onChange={e => setEditDisplayName(e.target.value)}
                  placeholder="表示名"
                  className="w-full bg-neutral-800 rounded-lg px-3 py-2 text-white placeholder-neutral-500 outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm text-neutral-400 mb-1">自己紹介</label>
                <textarea
                  value={editBio}
                  onChange={e => setEditBio(e.target.value)}
                  placeholder="自己紹介を入力"
                  rows={4}
                  className="w-full bg-neutral-800 rounded-lg px-3 py-2 text-white placeholder-neutral-500 outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
