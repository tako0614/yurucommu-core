import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Actor, Post } from '../types';
import { CommunityDetail, fetchCommunities, fetchFollowing, follow, searchActors, searchPosts, likePost, unlikePost } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { UserAvatar } from '../components/UserAvatar';
import { PostContent } from '../components/PostContent';
import { QRCodeModal } from '../components/QRCodeModal';

interface GroupPageProps {
  actor: Actor;
}

const CloseIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const SearchIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
  </svg>
);

const QRCodeIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h3v3h-3zM18 18h3v3h-3zM15 21h3M21 15v3" />
  </svg>
);

const HeartIcon = ({ filled }: { filled: boolean }) => (
  <svg className="w-5 h-5" fill={filled ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
  </svg>
);

const ChevronRightIcon = () => (
  <svg className="w-5 h-5 text-neutral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
  </svg>
);

const PlusIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
  </svg>
);

// Combine avatars into a circular collage
function AvatarCollage({ items, maxShow = 4 }: { items: { icon_url?: string | null; name: string }[]; maxShow?: number }) {
  const displayItems = items.slice(0, maxShow);

  if (displayItems.length === 0) {
    return (
      <div className="w-14 h-14 rounded-full bg-neutral-800 flex items-center justify-center">
        <span className="text-neutral-500 text-xl">?</span>
      </div>
    );
  }

  if (displayItems.length === 1) {
    return (
      <UserAvatar
        avatarUrl={displayItems[0].icon_url ?? null}
        name={displayItems[0].name}
        size={56}
      />
    );
  }

  // For 2-4 items, create a collage
  return (
    <div className="w-14 h-14 rounded-full overflow-hidden relative bg-neutral-800">
      {displayItems.length === 2 && (
        <>
          <div className="absolute top-0 left-0 w-7 h-14 overflow-hidden">
            <UserAvatar avatarUrl={displayItems[0].icon_url ?? null} name={displayItems[0].name} size={56} />
          </div>
          <div className="absolute top-0 right-0 w-7 h-14 overflow-hidden">
            <div className="absolute right-0">
              <UserAvatar avatarUrl={displayItems[1].icon_url ?? null} name={displayItems[1].name} size={56} />
            </div>
          </div>
        </>
      )}
      {displayItems.length === 3 && (
        <>
          <div className="absolute top-0 left-0 w-7 h-7 overflow-hidden">
            <UserAvatar avatarUrl={displayItems[0].icon_url ?? null} name={displayItems[0].name} size={28} />
          </div>
          <div className="absolute top-0 right-0 w-7 h-7 overflow-hidden">
            <UserAvatar avatarUrl={displayItems[1].icon_url ?? null} name={displayItems[1].name} size={28} />
          </div>
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-7 h-7 overflow-hidden">
            <UserAvatar avatarUrl={displayItems[2].icon_url ?? null} name={displayItems[2].name} size={28} />
          </div>
        </>
      )}
      {displayItems.length >= 4 && (
        <>
          <div className="absolute top-0 left-0 w-7 h-7 overflow-hidden">
            <UserAvatar avatarUrl={displayItems[0].icon_url ?? null} name={displayItems[0].name} size={28} />
          </div>
          <div className="absolute top-0 right-0 w-7 h-7 overflow-hidden">
            <UserAvatar avatarUrl={displayItems[1].icon_url ?? null} name={displayItems[1].name} size={28} />
          </div>
          <div className="absolute bottom-0 left-0 w-7 h-7 overflow-hidden">
            <UserAvatar avatarUrl={displayItems[2].icon_url ?? null} name={displayItems[2].name} size={28} />
          </div>
          <div className="absolute bottom-0 right-0 w-7 h-7 overflow-hidden">
            <UserAvatar avatarUrl={displayItems[3].icon_url ?? null} name={displayItems[3].name} size={28} />
          </div>
        </>
      )}
    </div>
  );
}

export function GroupPage({ actor }: GroupPageProps) {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchTab, setSearchTab] = useState<'users' | 'posts'>('users');
  const [searchUsersResult, setSearchUsersResult] = useState<Actor[]>([]);
  const [searchPostsResult, setSearchPostsResult] = useState<Post[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  // Communities state
  const [communities, setCommunities] = useState<CommunityDetail[]>([]);
  const [loadingCommunities, setLoadingCommunities] = useState(true);

  // Following state
  const [following, setFollowing] = useState<Actor[]>([]);
  const [loadingFollowing, setLoadingFollowing] = useState(true);

  // Favorites state (subset of following)
  const [favorites, setFavorites] = useState<Actor[]>([]);

  // QR Modal state
  const [showQRModal, setShowQRModal] = useState(false);

  useEffect(() => {
    // Load communities
    fetchCommunities()
      .then(data => setCommunities(data))
      .catch(e => console.error('Failed to load communities:', e))
      .finally(() => setLoadingCommunities(false));

    // Load following
    fetchFollowing(actor.ap_id)
      .then(data => {
        setFollowing(data);
        // For now, favorites is empty - can be implemented later
        setFavorites([]);
      })
      .catch(e => console.error('Failed to load following:', e))
      .finally(() => setLoadingFollowing(false));
  }, [actor.ap_id]);

  // Handle search query parameter from URL (e.g., from mention links)
  useEffect(() => {
    const searchParam = searchParams.get('search');
    if (searchParam) {
      setSearchQuery(searchParam);
      setSearchParams({});
      performSearch(searchParam);
    }
  }, [searchParams, setSearchParams]);

  const performSearch = async (query: string) => {
    if (!query.trim()) return;
    setSearching(true);
    setSearched(true);
    try {
      const [usersRes, postsRes] = await Promise.all([
        searchActors(query.trim()),
        searchPosts(query.trim()),
      ]);
      setSearchUsersResult(usersRes);
      setSearchPostsResult(postsRes);
    } catch (e) {
      console.error('Search failed:', e);
    } finally {
      setSearching(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') performSearch(searchQuery);
  };

  const clearSearch = () => {
    setSearchQuery('');
    setSearched(false);
    setSearchUsersResult([]);
    setSearchPostsResult([]);
  };

  const handleLike = async (post: Post) => {
    try {
      if (post.liked) {
        await unlikePost(post.ap_id);
        setSearchPostsResult(prev => prev.map(p => p.ap_id === post.ap_id ? { ...p, liked: false, like_count: p.like_count - 1 } : p));
      } else {
        await likePost(post.ap_id);
        setSearchPostsResult(prev => prev.map(p => p.ap_id === post.ap_id ? { ...p, liked: true, like_count: p.like_count + 1 } : p));
      }
    } catch (e) {
      console.error('Failed to toggle like:', e);
    }
  };

  const handleFollowFromSearch = async (targetActor: Actor, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await follow(targetActor.ap_id);
      // Add to following list
      setFollowing(prev => [...prev, targetActor]);
      // Update search results to reflect follow status
      setSearchUsersResult(prev => prev.filter(u => u.ap_id !== targetActor.ap_id));
    } catch (e) {
      console.error('Failed to follow:', e);
    }
  };

  // Check if a user is already followed
  const isFollowing = (actorApId: string) => following.some(f => f.ap_id === actorApId);

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

  // Get display names for categories
  const getFriendsPreview = () => {
    return following.slice(0, 3).map(m => m.name || m.preferred_username).join(', ');
  };

  const getGroupsPreview = () => {
    return communities.slice(0, 3).map(c => c.display_name || c.name).join(', ');
  };

  const isLoading = loadingCommunities || loadingFollowing;

  return (
    <div className="flex flex-col h-full bg-black">
      {/* Header with Search */}
      <header className="sticky top-0 bg-black/80 backdrop-blur-sm z-10">
        <div className="px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex-1 flex items-center gap-2 bg-neutral-900 rounded-lg px-3 py-2">
              <SearchIcon />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search"
                className="flex-1 bg-transparent outline-none text-white placeholder-neutral-500 text-sm"
              />
              {searchQuery && (
                <button onClick={clearSearch} className="text-neutral-500 hover:text-white">
                  <CloseIcon />
                </button>
              )}
            </div>
            <button
              onClick={() => setShowQRModal(true)}
              className="p-2 text-neutral-400 hover:text-white transition-colors"
            >
              <QRCodeIcon />
            </button>
          </div>
        </div>

        {/* Search result tabs */}
        {searched && (
          <div className="flex border-t border-neutral-900">
            <button
              onClick={() => setSearchTab('users')}
              className={`flex-1 py-3 text-center font-medium relative ${searchTab === 'users' ? 'text-white' : 'text-neutral-500'}`}
            >
              Users ({searchUsersResult.length})
              {searchTab === 'users' && <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-16 h-1 bg-blue-500 rounded-full" />}
            </button>
            <button
              onClick={() => setSearchTab('posts')}
              className={`flex-1 py-3 text-center font-medium relative ${searchTab === 'posts' ? 'text-white' : 'text-neutral-500'}`}
            >
              Posts ({searchPostsResult.length})
              {searchTab === 'posts' && <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-1 bg-blue-500 rounded-full" />}
            </button>
          </div>
        )}
      </header>

      <div className="flex-1 overflow-y-auto">
        {/* Search Results */}
        {searching ? (
          <div className="p-8 text-center text-neutral-500">{t('common.loading')}</div>
        ) : searched ? (
          searchTab === 'users' ? (
            searchUsersResult.length === 0 ? (
              <div className="p-8 text-center text-neutral-500">No users found</div>
            ) : (
              searchUsersResult.map(user => (
                <div
                  key={user.ap_id}
                  className="flex items-center gap-3 px-4 py-3 border-b border-neutral-900 hover:bg-neutral-900/30 transition-colors"
                >
                  <Link to={`/profile/${encodeURIComponent(user.ap_id)}`}>
                    <UserAvatar avatarUrl={user.icon_url} name={user.name || user.preferred_username} size={48} />
                  </Link>
                  <div className="flex-1 min-w-0">
                    <Link to={`/profile/${encodeURIComponent(user.ap_id)}`} className="hover:underline">
                      <div className="font-bold text-white truncate">{user.name || user.preferred_username}</div>
                    </Link>
                    <div className="text-neutral-500 truncate">@{user.username}</div>
                    {user.summary && <div className="text-sm text-neutral-400 truncate mt-1">{user.summary}</div>}
                  </div>
                  {user.ap_id !== actor.ap_id && !isFollowing(user.ap_id) && (
                    <button
                      onClick={(e) => handleFollowFromSearch(user, e)}
                      className="px-4 py-1.5 bg-white text-black font-medium rounded-full hover:bg-neutral-200 transition-colors text-sm shrink-0"
                    >
                      Follow
                    </button>
                  )}
                  {isFollowing(user.ap_id) && (
                    <span className="px-4 py-1.5 border border-neutral-700 text-neutral-400 font-medium rounded-full text-sm shrink-0">
                      Following
                    </span>
                  )}
                </div>
              ))
            )
          ) : (
            searchPostsResult.length === 0 ? (
              <div className="p-8 text-center text-neutral-500">No posts found</div>
            ) : (
              searchPostsResult.map(post => (
                <div key={post.ap_id} className="flex gap-3 px-4 py-3 border-b border-neutral-900 hover:bg-neutral-900/30 transition-colors">
                  <Link to={`/profile/${encodeURIComponent(post.author.ap_id)}`}>
                    <UserAvatar avatarUrl={post.author.icon_url} name={post.author.name || post.author.preferred_username} size={48} />
                  </Link>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <Link to={`/profile/${encodeURIComponent(post.author.ap_id)}`} className="font-bold text-white truncate hover:underline">
                        {post.author.name || post.author.preferred_username}
                      </Link>
                      <span className="text-neutral-500 truncate">@{post.author.username}</span>
                      <span className="text-neutral-500">·</span>
                      <span className="text-neutral-500 text-sm">{formatTime(post.published)}</span>
                    </div>
                    <Link to={`/post/${encodeURIComponent(post.ap_id)}`}>
                      <PostContent content={post.content} className="text-[15px] text-neutral-200 mt-1" />
                    </Link>
                    <div className="flex items-center gap-6 mt-3">
                      <button
                        onClick={() => handleLike(post)}
                        className={`flex items-center gap-2 transition-colors ${post.liked ? 'text-pink-500' : 'text-neutral-500 hover:text-pink-500'}`}
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
            )
          )
        ) : isLoading ? (
          <div className="p-8 text-center text-neutral-500">{t('common.loading')}</div>
        ) : (
          /* Friends List View - LINE style */
          <>
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3">
              <h2 className="text-lg font-bold text-white">Friends List</h2>
              <button className="text-sm text-neutral-400 hover:text-white transition-colors flex items-center gap-1">
                <PlusIcon />
              </button>
            </div>

            {/* Favorites Section */}
            {favorites.length > 0 && (
              <Link
                to="/friends"
                className="flex items-center gap-4 px-4 py-3 hover:bg-neutral-900/30 transition-colors"
              >
                <AvatarCollage
                  items={favorites.map(f => ({ icon_url: f.icon_url, name: f.name || f.preferred_username }))}
                />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-white">Favorites</div>
                  <div className="text-sm text-neutral-500 truncate">
                    {favorites.slice(0, 3).map(f => f.name || f.preferred_username).join(', ')}
                  </div>
                </div>
                <div className="flex items-center gap-1 text-neutral-500">
                  <span>{favorites.length}</span>
                  <ChevronRightIcon />
                </div>
              </Link>
            )}

            {/* Friends Section */}
            <Link
              to="/friends"
              className="flex items-center gap-4 px-4 py-3 hover:bg-neutral-900/30 transition-colors"
            >
              <AvatarCollage
                items={following.map(f => ({ icon_url: f.icon_url, name: f.name || f.preferred_username }))}
              />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-white">Friends</div>
                <div className="text-sm text-neutral-500 truncate">
                  {getFriendsPreview() || 'No friends yet'}
                </div>
              </div>
              <div className="flex items-center gap-1 text-neutral-500">
                <span>{following.length}</span>
                <ChevronRightIcon />
              </div>
            </Link>

            {/* Groups Section */}
            <Link
              to="/friends/groups"
              className="flex items-center gap-4 px-4 py-3 hover:bg-neutral-900/30 transition-colors"
            >
              <div className="w-14 h-14 rounded-full bg-neutral-800 flex items-center justify-center overflow-hidden">
                {communities.length > 0 && communities[0].icon_url ? (
                  <img src={communities[0].icon_url} alt="" className="w-full h-full object-cover" />
                ) : communities.length > 0 ? (
                  <span className="text-xl font-medium text-white">{(communities[0]?.display_name || communities[0]?.name)?.charAt(0).toUpperCase()}</span>
                ) : (
                  <span className="text-neutral-500 text-xl">G</span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-white">Groups</div>
                <div className="text-sm text-neutral-500 truncate">
                  {getGroupsPreview() || 'No groups yet'}
                </div>
              </div>
              <div className="flex items-center gap-1 text-neutral-500">
                <span>{communities.length}</span>
                <ChevronRightIcon />
              </div>
            </Link>
          </>
        )}
      </div>

      {/* QR Code Modal */}
      {showQRModal && (
        <QRCodeModal
          actor={actor}
          onClose={() => setShowQRModal(false)}
        />
      )}
    </div>
  );
}
