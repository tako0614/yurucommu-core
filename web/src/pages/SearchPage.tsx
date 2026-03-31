import { useEffect, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { atom } from 'jotai';
import { useAtom } from 'jotai';
import { useRequiredActor } from '../hooks/useRequiredActor.ts';
import { Actor, Post } from '../types/index.ts';
import {
  CommunityDetail,
  fetchCommunities,
  fetchTrendingHashtags,
  searchActors,
  searchPosts,
  searchRemote,
  follow,
  likePost,
  unlikePost,
  fetchFollowing,
} from '../lib/api.ts';
import { useI18n } from '../lib/i18n.tsx';
import { formatRelativeTime } from '../lib/datetime.ts';
import { UserAvatar } from '../components/UserAvatar.tsx';
import { PostContent } from '../components/PostContent.tsx';
import { InlineErrorBanner } from '../components/InlineErrorBanner.tsx';
import { HeartIcon } from '../components/icons/SocialIcons.tsx';

const REMOTE_ACTOR_QUERY_PATTERN = /^@?[^@\s]+@[^@\s]+$/;

type SearchTab = 'users' | 'posts' | 'communities';

// Atoms defined at module level
const search_errorAtom = atom<string | null>(null);
const search_searchQueryAtom = atom('');
const search_searchTabAtom = atom<SearchTab>('users');
const search_searchUsersResultAtom = atom<Actor[]>([]);
const search_searchPostsResultAtom = atom<Post[]>([]);
const search_searchingAtom = atom(false);
const search_searchedAtom = atom(false);
const search_communitiesAtom = atom<CommunityDetail[]>([]);
const search_filteredCommunitiesAtom = atom<CommunityDetail[]>([]);
const search_followingAtom = atom<Actor[]>([]);
const search_trendingHashtagsAtom = atom<{ tag: string; count: number }[]>([]);

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

export function SearchPage() {
  const actor = useRequiredActor();
  const { t } = useI18n();
  const [error, setError] = useAtom(search_errorAtom);
  const clearError = useCallback(() => setError(null), [setError]);
  const [searchParams, setSearchParams] = useSearchParams();

  const [searchQuery, setSearchQuery] = useAtom(search_searchQueryAtom);
  const [searchTab, setSearchTab] = useAtom(search_searchTabAtom);
  const [searchUsersResult, setSearchUsersResult] = useAtom(search_searchUsersResultAtom);
  const [searchPostsResult, setSearchPostsResult] = useAtom(search_searchPostsResultAtom);
  const [searching, setSearching] = useAtom(search_searchingAtom);
  const [searched, setSearched] = useAtom(search_searchedAtom);

  const [communities, setCommunities] = useAtom(search_communitiesAtom);
  const [filteredCommunities, setFilteredCommunities] = useAtom(search_filteredCommunitiesAtom);

  const [following, setFollowing] = useAtom(search_followingAtom);

  const [trendingHashtags, setTrendingHashtags] = useAtom(search_trendingHashtagsAtom);

  useEffect(() => {
    setSearchQuery('');
    setSearched(false);
    setSearchUsersResult([]);
    setSearchPostsResult([]);
    fetchTrendingHashtags(10).catch(() => []).then(setTrendingHashtags);
    fetchCommunities().then(setCommunities).catch((e) => console.error('Failed to fetch communities', e));
    fetchFollowing(actor.ap_id).then(setFollowing).catch((e) => console.error('Failed to fetch following', e));
  }, [actor.ap_id]);

  // Handle search query parameter from URL
  useEffect(() => {
    const searchParam = searchParams.get('search');
    if (searchParam) {
      setSearchQuery(searchParam);
      setSearchParams({});
      performSearch(searchParam);
    }
  }, [searchParams, setSearchParams]);

  const performSearch = async (query: string) => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return;

    const shouldSearchRemote = REMOTE_ACTOR_QUERY_PATTERN.test(trimmedQuery);

    setSearching(true);
    setSearched(true);
    try {
      const [usersRes, postsRes, remoteUsersRes] = await Promise.all([
        searchActors(trimmedQuery),
        searchPosts(trimmedQuery),
        shouldSearchRemote ? searchRemote(trimmedQuery) : Promise.resolve([] as Actor[]),
      ]);

      const mergedUsers = [...usersRes];
      for (const remoteUser of remoteUsersRes) {
        if (!mergedUsers.some((u) => u.ap_id === remoteUser.ap_id)) {
          mergedUsers.push(remoteUser);
        }
      }

      setSearchUsersResult(mergedUsers);
      setSearchPostsResult(postsRes);

      // Client-side community filter
      const lowerQuery = trimmedQuery.toLowerCase();
      setFilteredCommunities(
        communities.filter(
          (c) =>
            (c.display_name || c.name).toLowerCase().includes(lowerQuery) ||
            (c.summary || '').toLowerCase().includes(lowerQuery)
        )
      );
    } catch (e) {
      console.error('Search failed:', e);
      setError(t('common.error'));
    } finally {
      setSearching(false);
    }
  };

  const clearSearch = () => {
    setSearchQuery('');
    setSearched(false);
    setSearchUsersResult([]);
    setSearchPostsResult([]);
    setFilteredCommunities([]);
  };

  const handleLike = async (post: Post) => {
    try {
      if (post.liked) {
        await unlikePost(post.ap_id);
        setSearchPostsResult((prev) =>
          prev.map((p) =>
            p.ap_id === post.ap_id ? { ...p, liked: false, like_count: p.like_count - 1 } : p
          )
        );
      } else {
        await likePost(post.ap_id);
        setSearchPostsResult((prev) =>
          prev.map((p) =>
            p.ap_id === post.ap_id ? { ...p, liked: true, like_count: p.like_count + 1 } : p
          )
        );
      }
    } catch (e) {
      console.error('Failed to toggle like:', e);
      setError(t('common.error'));
    }
  };

  const handleFollow = async (targetActor: Actor, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await follow(targetActor.ap_id);
      setFollowing((prev) => [...prev, targetActor]);
      setSearchUsersResult((prev) => prev.filter((u) => u.ap_id !== targetActor.ap_id));
    } catch (e) {
      console.error('Failed to follow:', e);
      setError(t('common.error'));
    }
  };

  const isFollowing = (actorApId: string) => following.some((f) => f.ap_id === actorApId);

  const tabs: { key: SearchTab; label: string; count: number }[] = [
    { key: 'users', label: t('nav.members'), count: searchUsersResult.length },
    { key: 'posts', label: t('profile.posts'), count: searchPostsResult.length },
    { key: 'communities', label: t('timeline.communities'), count: filteredCommunities.length },
  ];

  return (
    <div className="flex flex-col h-full bg-neutral-900">
      {error && <InlineErrorBanner message={error} onClose={clearError} />}

      {/* Header with Search */}
      <header className="sticky top-0 bg-neutral-900/80 backdrop-blur-sm z-10">
        <div className="px-4 py-3">
          <form
            className="flex items-center gap-2 bg-neutral-900 rounded-lg px-3 py-2"
            onSubmit={(e) => {
              e.preventDefault();
              performSearch(searchQuery);
            }}
          >
            <button type="submit" aria-label="Search" className="text-neutral-500 hover:text-white transition-colors">
              <SearchIcon />
            </button>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('nav.search')}
              className="flex-1 bg-transparent outline-none text-white placeholder-neutral-500 text-sm"
            />
            {searchQuery && (
              <button type="button" onClick={clearSearch} aria-label="Clear search" className="text-neutral-500 hover:text-white">
                <CloseIcon />
              </button>
            )}
          </form>
        </div>

        {/* Search result tabs */}
        {searched && (
          <div className="flex border-t border-neutral-900">
            {tabs.map(({ key, label, count }) => (
              <button
                key={key}
                onClick={() => setSearchTab(key)}
                className={`flex-1 py-3 text-center text-sm font-medium relative ${searchTab === key ? 'text-white' : 'text-neutral-500'}`}
              >
                {label} ({count})
                {searchTab === key && (
                  <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-1 bg-blue-500 rounded-full" />
                )}
              </button>
            ))}
          </div>
        )}
      </header>

      <div className="flex-1 overflow-y-auto">
        {searching ? (
          <div className="p-8 text-center text-neutral-500">{t('common.loading')}</div>
        ) : searched ? (
          <>
            {/* Users tab */}
            {searchTab === 'users' &&
              (searchUsersResult.length === 0 ? (
                <div className="p-8 text-center text-neutral-500">{t('search.noResults')}</div>
              ) : (
                searchUsersResult.map((user) => (
                  <div key={user.ap_id} className="flex items-center gap-3 px-4 py-3 border-b border-neutral-900 hover:bg-neutral-900/30 transition-colors">
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
                        onClick={(e) => handleFollow(user, e)}
                        className="px-4 py-1.5 bg-white text-black font-medium rounded-full hover:bg-neutral-200 transition-colors text-sm shrink-0"
                      >
                        {t('profile.follow')}
                      </button>
                    )}
                    {isFollowing(user.ap_id) && (
                      <span className="px-4 py-1.5 border border-neutral-700 text-neutral-400 font-medium rounded-full text-sm shrink-0">
                        {t('profile.following')}
                      </span>
                    )}
                  </div>
                ))
              ))}

            {/* Posts tab */}
            {searchTab === 'posts' &&
              (searchPostsResult.length === 0 ? (
                <div className="p-8 text-center text-neutral-500">{t('search.noResults')}</div>
              ) : (
                searchPostsResult.map((post) => (
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
                        <span className="text-neutral-500 text-sm">{formatRelativeTime(post.published)}</span>
                      </div>
                      <Link to={`/post/${encodeURIComponent(post.ap_id)}`}>
                        <PostContent content={post.content} className="text-[15px] text-neutral-200 mt-1" />
                      </Link>
                      <div className="flex items-center gap-6 mt-3">
                        <button
                          onClick={() => handleLike(post)}
                          aria-label={post.liked ? 'Unlike' : 'Like'}
                          aria-pressed={post.liked}
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
              ))}

            {/* Communities tab */}
            {searchTab === 'communities' &&
              (filteredCommunities.length === 0 ? (
                <div className="p-8 text-center text-neutral-500">{t('search.noResults')}</div>
              ) : (
                filteredCommunities.map((community) => (
                  <Link
                    key={community.name}
                    to={`/groups/${community.name}`}
                    className="flex items-center gap-3 px-4 py-3 border-b border-neutral-900 hover:bg-neutral-900/30 transition-colors"
                  >
                    <div className="w-12 h-12 rounded-full bg-neutral-800 flex items-center justify-center overflow-hidden shrink-0">
                      {community.icon_url ? (
                        <img src={community.icon_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-lg font-medium text-white">
                          {(community.display_name || community.name).charAt(0).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-white truncate">{community.display_name || community.name}</div>
                      {community.summary && (
                        <div className="text-sm text-neutral-400 truncate mt-0.5">{community.summary}</div>
                      )}
                      <div className="text-xs text-neutral-500 mt-0.5">
                        {community.member_count ?? 0} {t('groups.members')}
                      </div>
                    </div>
                  </Link>
                ))
              ))}
          </>
        ) : (
          /* Trending hashtags when not searching */
          <div className="px-4 py-4">
            <h2 className="text-lg font-bold text-white mb-4">{t('search.trending')}</h2>
            {trendingHashtags.length === 0 ? (
              <div className="text-neutral-500 text-sm">{t('search.noResults')}</div>
            ) : (
              <div className="space-y-3">
                {trendingHashtags.map(({ tag, count }) => (
                  <button
                    key={tag}
                    onClick={() => {
                      setSearchQuery(`#${tag}`);
                      setSearchTab('posts');
                      performSearch(`#${tag}`);
                    }}
                    className="block w-full text-left px-3 py-2.5 rounded-lg hover:bg-neutral-900/50 transition-colors"
                  >
                    <div className="font-medium text-white">#{tag}</div>
                    <div className="text-xs text-neutral-500 mt-0.5">
                      {count} {t('profile.posts').toLowerCase()}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default SearchPage;
