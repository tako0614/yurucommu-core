import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Actor } from '../types';
import { fetchFollowing, fetchFollowers } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { UserAvatar } from '../components/UserAvatar';
import { InlineErrorBanner } from '../components/InlineErrorBanner';
import { useInlineError } from '../hooks/useInlineError';

interface FriendsListPageProps {
  actor: Actor;
}

const BackIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
  </svg>
);

const MessageIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
  </svg>
);

const SearchIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
  </svg>
);

type TabType = 'following' | 'followers';

export function FriendsListPage({ actor }: FriendsListPageProps) {
  const { t } = useI18n();
  const { error, setError, clearError } = useInlineError();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabType>('following');
  const [following, setFollowing] = useState<Actor[]>([]);
  const [followers, setFollowers] = useState<Actor[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadFriends();
  }, []);

  const loadFriends = async () => {
    setLoading(true);
    try {
      const [followingData, followersData] = await Promise.all([
        fetchFollowing(actor.ap_id),
        fetchFollowers(actor.ap_id),
      ]);
      setFollowing(followingData);
      setFollowers(followersData);
    } catch (e) {
      console.error('Failed to load friends:', e);
      setError(t('common.error'));
    } finally {
      setLoading(false);
    }
  };

  const handleStartDM = (friendApId: string) => {
    navigate(`/dm/${encodeURIComponent(friendApId)}`);
  };

  const currentList = activeTab === 'following' ? following : followers;
  const filteredList = searchQuery
    ? currentList.filter(f =>
        (f.name?.toLowerCase().includes(searchQuery.toLowerCase())) ||
        f.preferred_username.toLowerCase().includes(searchQuery.toLowerCase()) ||
        f.username.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : currentList;

  return (
    <div className="flex flex-col h-full">
      {error && (
        <InlineErrorBanner message={error} onClose={clearError} />
      )}
      {/* Header */}
      <header className="sticky top-0 bg-black/80 backdrop-blur-sm border-b border-neutral-900 z-10">
        <div className="flex items-center gap-4 px-4 py-3">
          <button
            onClick={() => navigate(-1)}
            aria-label="Back"
            className="p-2 -ml-2 hover:bg-neutral-900 rounded-full"
          >
            <BackIcon />
          </button>
          <h1 className="text-xl font-bold">{t('nav.friends') || 'Friends'}</h1>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-neutral-900">
          <button
            onClick={() => setActiveTab('following')}
            className={`flex-1 py-3 text-center font-medium relative transition-colors ${
              activeTab === 'following' ? 'text-white' : 'text-neutral-500 hover:bg-neutral-900/50'
            }`}
          >
            {t('profile.following')} ({following.length})
            {activeTab === 'following' && (
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-16 h-1 bg-blue-500 rounded-full" />
            )}
          </button>
          <button
            onClick={() => setActiveTab('followers')}
            className={`flex-1 py-3 text-center font-medium relative transition-colors ${
              activeTab === 'followers' ? 'text-white' : 'text-neutral-500 hover:bg-neutral-900/50'
            }`}
          >
            {t('profile.followers')} ({followers.length})
            {activeTab === 'followers' && (
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-16 h-1 bg-blue-500 rounded-full" />
            )}
          </button>
        </div>
      </header>

      {/* Search */}
      <div className="px-4 py-3 border-b border-neutral-900">
        <div className="flex items-center gap-2 bg-neutral-900 rounded-full px-4 py-2">
          <SearchIcon />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search friends..."
            className="flex-1 bg-transparent text-white placeholder-neutral-500 outline-none"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-8 text-center text-neutral-500">{t('common.loading')}</div>
        ) : filteredList.length === 0 ? (
          <div className="p-8 text-center text-neutral-500">
            {searchQuery
              ? 'No results found'
              : activeTab === 'following'
                ? 'Not following anyone yet'
                : 'No followers yet'}
          </div>
        ) : (
          filteredList.map((friend) => (
            <div
              key={friend.ap_id}
              className="flex items-center gap-3 px-4 py-3 hover:bg-neutral-900/30 transition-colors"
            >
              <Link to={`/profile/${encodeURIComponent(friend.ap_id)}`}>
                <UserAvatar
                  avatarUrl={friend.icon_url}
                  name={friend.name || friend.preferred_username}
                  size={48}
                />
              </Link>
              <Link
                to={`/profile/${encodeURIComponent(friend.ap_id)}`}
                className="flex-1 min-w-0"
              >
                <div className="font-bold text-white truncate">
                  {friend.name || friend.preferred_username}
                </div>
                <div className="text-neutral-500 truncate">@{friend.username}</div>
              </Link>
              <button
                onClick={() => handleStartDM(friend.ap_id)}
                className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-full transition-colors"
                title="Send message"
              >
                <MessageIcon />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
