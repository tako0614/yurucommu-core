import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Actor, Post } from '../types';
import {
  fetchActor,
  fetchFollowers,
  fetchFollowing,
  follow,
  unfollow,
  likePost,
  unlikePost,
  updateProfile,
  fetchActorPosts,
  fetchAccounts,
  switchAccount,
  AccountInfo,
} from '../lib/api';
import { useI18n } from '../lib/i18n';
import { formatMonthYear, formatRelativeTime } from '../lib/datetime';
import { UserAvatar } from '../components/UserAvatar';
import { PostContent } from '../components/PostContent';
import { HeartIcon, ReplyIcon } from '../components/icons/SocialIcons';

interface ProfilePageProps {
  actor: Actor;
}

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

export function ProfilePage({ actor }: ProfilePageProps) {
  const { t } = useI18n();
  const { actorId } = useParams<{ actorId?: string }>();
  const [profile, setProfile] = useState<Actor | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFollowing, setIsFollowing] = useState(false);
  const [activeTab, setActiveTab] = useState<'posts' | 'likes'>('posts');
  const [showEditModal, setShowEditModal] = useState(false);
  const [editName, setEditName] = useState('');
  const [editSummary, setEditSummary] = useState('');
  const [saving, setSaving] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showFollowModal, setShowFollowModal] = useState<'followers' | 'following' | null>(null);
  const [editIsPrivate, setEditIsPrivate] = useState(false);
  const [followModalActors, setFollowModalActors] = useState<Actor[]>([]);
  const [followModalLoading, setFollowModalLoading] = useState(false);
  const [showAccountSwitcher, setShowAccountSwitcher] = useState(false);
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);
  const [currentApId, setCurrentApId] = useState<string>('');
  const [accountsLoading, setAccountsLoading] = useState(false);

  // Use current actor if no actorId in URL
  const targetActorId = actorId ? decodeURIComponent(actorId) : actor.ap_id;
  const isOwnProfile = targetActorId === actor.ap_id;

  const loadAccounts = async () => {
    setAccountsLoading(true);
    try {
      const data = await fetchAccounts();
      setAccounts(data.accounts);
      setCurrentApId(data.current_ap_id);
    } catch (e) {
      console.error('Failed to load accounts:', e);
    } finally {
      setAccountsLoading(false);
    }
  };

  const handleSwitchAccount = async (apId: string) => {
    if (apId === currentApId) {
      setShowAccountSwitcher(false);
      return;
    }
    try {
      await switchAccount(apId);
      window.location.reload();
    } catch (e) {
      console.error('Failed to switch account:', e);
    }
  };

  const toggleAccountSwitcher = () => {
    if (!showAccountSwitcher) {
      loadAccounts();
    }
    setShowAccountSwitcher(!showAccountSwitcher);
  };

  const loadProfile = useCallback(async () => {
    try {
      const profileData = await fetchActor(targetActorId);
      setProfile(profileData);
      setIsFollowing(profileData.is_following || false);
      const postsData = await fetchActorPosts(targetActorId);
      setPosts(postsData);
    } catch (e) {
      console.error('Failed to load profile:', e);
    } finally {
      setLoading(false);
    }
  }, [targetActorId]);

  useEffect(() => {
    setLoading(true);
    loadProfile();
  }, [loadProfile]);

  const handleFollow = async () => {
    if (!profile) return;
    try {
      if (isFollowing) {
        await unfollow(profile.ap_id);
        setIsFollowing(false);
        setProfile(prev => prev ? { ...prev, follower_count: prev.follower_count - 1 } : null);
      } else {
        await follow(profile.ap_id);
        setIsFollowing(true);
        setProfile(prev => prev ? { ...prev, follower_count: prev.follower_count + 1 } : null);
      }
    } catch (e) {
      console.error('Failed to toggle follow:', e);
    }
  };

  const handleLike = async (post: Post) => {
    try {
      if (post.liked) {
        await unlikePost(post.ap_id);
        setPosts(prev => prev.map(p => p.ap_id === post.ap_id ? { ...p, liked: false, like_count: p.like_count - 1 } : p));
      } else {
        await likePost(post.ap_id);
        setPosts(prev => prev.map(p => p.ap_id === post.ap_id ? { ...p, liked: true, like_count: p.like_count + 1 } : p));
      }
    } catch (e) {
      console.error('Failed to toggle like:', e);
    }
  };

  const openEditModal = () => {
    if (profile) {
      setEditName(profile.name || '');
      setEditSummary(profile.summary || '');
      setEditIsPrivate(profile.is_private || false);
      setShowEditModal(true);
    }
  };

  const handleSaveProfile = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await updateProfile({
        name: editName.trim() || undefined,
        summary: editSummary.trim() || undefined,
        is_private: editIsPrivate,
      });
      setProfile(prev => prev ? {
        ...prev,
        name: editName.trim() || prev.preferred_username,
        summary: editSummary.trim(),
        is_private: editIsPrivate,
      } : null);
      setShowEditModal(false);
    } catch (e) {
      console.error('Failed to update profile:', e);
    } finally {
      setSaving(false);
    }
  };

  const openFollowModal = async (type: 'followers' | 'following') => {
    setShowFollowModal(type);
    setFollowModalLoading(true);
    setFollowModalActors([]);
    try {
      const data = type === 'followers'
        ? await fetchFollowers(targetActorId)
        : await fetchFollowing(targetActorId);
      setFollowModalActors(data);
    } catch (e) {
      console.error(`Failed to load ${type}:`, e);
    } finally {
      setFollowModalLoading(false);
    }
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
        <div className="flex items-center justify-between px-4 py-3">
          {/* Left: Back button (only when viewing other's profile) */}
          <div className="w-10">
            {actorId && (
              <Link to="/" aria-label="Back" className="p-2 -ml-2 hover:bg-neutral-900 rounded-full inline-block">
                <BackIcon />
              </Link>
            )}
          </div>

          {/* Center: Username with account switcher (own profile only) */}
          {isOwnProfile ? (
            <button
              onClick={toggleAccountSwitcher}
              className="flex items-center gap-1 hover:bg-neutral-900 px-3 py-1 rounded-full transition-colors"
            >
              <span className="font-bold text-white">@{profile.username}</span>
              <svg className={`w-4 h-4 transition-transform ${showAccountSwitcher ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          ) : (
            <span className="font-bold text-white">@{profile.username}</span>
          )}

          {/* Right: Placeholder for balance */}
          <div className="w-10" />
        </div>

        {/* Account Switcher Dropdown */}
        {showAccountSwitcher && isOwnProfile && (
          <div className="absolute left-1/2 -translate-x-1/2 top-14 bg-neutral-900 rounded-xl shadow-lg border border-neutral-800 min-w-[250px] z-20">
            {accountsLoading ? (
              <div className="p-4 text-center text-neutral-500">読み込み中...</div>
            ) : (
              <div className="py-2">
                {accounts.map((account) => (
                  <button
                    key={account.ap_id}
                    onClick={() => handleSwitchAccount(account.ap_id)}
                    className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-neutral-800 transition-colors ${
                      account.ap_id === currentApId ? 'bg-neutral-800/50' : ''
                    }`}
                  >
                    <UserAvatar avatarUrl={account.icon_url} name={account.name || account.preferred_username} size={40} />
                    <div className="flex-1 text-left">
                      <p className="font-bold text-white">{account.name || account.preferred_username}</p>
                      <p className="text-sm text-neutral-500">@{account.preferred_username}</p>
                    </div>
                    {account.ap_id === currentApId && (
                      <svg className="w-5 h-5 text-blue-500" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </header>

      {/* Backdrop for account switcher */}
      {showAccountSwitcher && (
        <div
          className="fixed inset-0 z-10"
          onClick={() => setShowAccountSwitcher(false)}
        />
      )}

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
                avatarUrl={profile.icon_url}
                name={profile.name || profile.preferred_username}
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
                    aria-label="More options"
                    className="p-2 border border-neutral-600 rounded-full hover:bg-neutral-900 transition-colors"
                  >
                    <MoreIcon />
                  </button>
                  {showMenu && (
                    <div className="absolute right-0 top-full mt-1 bg-neutral-900 rounded-xl shadow-lg py-1 min-w-[180px] z-20 border border-neutral-800">
                      <button
                        onClick={() => setShowMenu(false)}
                        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-neutral-800 transition-colors"
                      >
                        Report
                      </button>
                    </div>
                  )}
                </div>
                <button
                  onClick={handleFollow}
                  className={`px-4 py-2 rounded-full font-bold transition-colors ${
                    isFollowing
                      ? 'bg-transparent border border-neutral-600 text-white hover:border-red-500 hover:text-red-500'
                      : 'bg-white text-black hover:bg-neutral-200'
                  }`}
                >
                  {isFollowing ? t('profile.unfollow') : t('profile.follow')}
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
              {profile.name || profile.preferred_username}
            </div>
            <div className="text-neutral-500">@{profile.username}</div>
          </div>

          {/* Bio */}
          {profile.summary && (
            <p className="text-neutral-200 mb-3 whitespace-pre-wrap">{profile.summary}</p>
          )}

          {/* Join Date */}
          <div className="flex items-center gap-1 text-neutral-500 text-sm mb-3">
            <CalendarIcon />
            <span>Joined {formatMonthYear(profile.created_at)}</span>
          </div>

          {/* Follow Stats */}
          <div className="flex gap-4 text-sm">
            <button
              onClick={() => openFollowModal('following')}
              className="hover:underline"
            >
              <span className="font-bold text-white">{profile.following_count}</span>
              <span className="text-neutral-500 ml-1">{t('profile.following')}</span>
            </button>
            <button
              onClick={() => openFollowModal('followers')}
              className="hover:underline"
            >
              <span className="font-bold text-white">{profile.follower_count}</span>
              <span className="text-neutral-500 ml-1">{t('profile.followers')}</span>
            </button>
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
                  key={post.ap_id}
                  className="flex gap-3 px-4 py-3 border-b border-neutral-900 hover:bg-neutral-900/30 transition-colors"
                >
                  <Link to={`/profile/${encodeURIComponent(post.author.ap_id)}`}>
                    <UserAvatar
                      avatarUrl={post.author.icon_url}
                      name={post.author.name || post.author.preferred_username}
                      size={48}
                    />
                  </Link>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <Link to={`/profile/${encodeURIComponent(post.author.ap_id)}`} className="font-bold text-white truncate hover:underline">
                        {post.author.name || post.author.preferred_username}
                      </Link>
                      <span className="text-neutral-500 truncate">@{post.author.username}</span>
                      <span className="text-neutral-500">·</span>
                      <span className="text-neutral-500 text-sm">{formatRelativeTime(post.published)}</span>
                    </div>
                    <PostContent
                      content={post.content}
                      className="text-[15px] text-neutral-200 mt-1"
                    />
                    {/* Actions */}
                    <div className="flex items-center gap-6 mt-3">
                      <button aria-label="Reply" className="flex items-center gap-2 text-neutral-500 hover:text-blue-500 transition-colors">
                        <ReplyIcon />
                        <span className="text-sm">{post.reply_count || ''}</span>
                      </button>
                      <button
                        onClick={() => handleLike(post)}
                        aria-label={post.liked ? 'Unlike' : 'Like'}
                        aria-pressed={post.liked}
                        className={`flex items-center gap-2 transition-colors ${
                          post.liked ? 'text-pink-500' : 'text-neutral-500 hover:text-pink-500'
                        }`}
                      >
                        <HeartIcon filled={post.liked || false} />
                        {post.author.ap_id === actor.ap_id && post.like_count > 0 && (
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
          <div className="p-8 text-center text-neutral-500">{t('profile.noLikes')}</div>
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
                  aria-label="Close"
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
                <label className="block text-sm text-neutral-400 mb-1">Name</label>
                <input
                  type="text"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  placeholder="Display name"
                  className="w-full bg-neutral-800 rounded-lg px-3 py-2 text-white placeholder-neutral-500 outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm text-neutral-400 mb-1">Bio</label>
                <textarea
                  value={editSummary}
                  onChange={e => setEditSummary(e.target.value)}
                  placeholder="Tell us about yourself"
                  rows={4}
                  className="w-full bg-neutral-800 rounded-lg px-3 py-2 text-white placeholder-neutral-500 outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
              <div className="flex items-center justify-between py-2">
                <div>
                  <div className="text-white font-medium">フォロー許可制</div>
                  <div className="text-sm text-neutral-400">フォローリクエストを承認制にする</div>
                </div>
                <button
                  type="button"
                  onClick={() => setEditIsPrivate(!editIsPrivate)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    editIsPrivate ? 'bg-blue-500' : 'bg-neutral-600'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      editIsPrivate ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Followers/Following Modal */}
      {showFollowModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-neutral-900 rounded-2xl w-full max-w-md max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
              <div className="flex items-center gap-4">
                <button
                  onClick={() => setShowFollowModal(null)}
                  aria-label="Close"
                  className="p-1 hover:bg-neutral-800 rounded-full transition-colors"
                >
                  <CloseIcon />
                </button>
                <h2 className="text-lg font-bold">
                  {showFollowModal === 'followers' ? t('profile.followers') : t('profile.following')}
                </h2>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {followModalLoading ? (
                <div className="p-8 text-center text-neutral-500">{t('common.loading')}</div>
              ) : followModalActors.length === 0 ? (
                <div className="p-8 text-center text-neutral-500">
                  {showFollowModal === 'followers' ? 'No followers yet' : 'Not following anyone'}
                </div>
              ) : (
                followModalActors.map(a => (
                  <Link
                    key={a.ap_id}
                    to={`/profile/${encodeURIComponent(a.ap_id)}`}
                    onClick={() => setShowFollowModal(null)}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-neutral-800 transition-colors"
                  >
                    <UserAvatar
                      avatarUrl={a.icon_url}
                      name={a.name || a.preferred_username}
                      size={48}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-white truncate">
                        {a.name || a.preferred_username}
                      </div>
                      <div className="text-neutral-500 truncate">@{a.username}</div>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
