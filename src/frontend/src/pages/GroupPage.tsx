import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Community, Member, Post } from '../types';
import { fetchCommunities, createCommunity, updateCommunity, deleteCommunity, searchUsers, searchPosts, likePost, unlikePost } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { UserAvatar } from '../components/UserAvatar';
import { PostContent } from '../components/PostContent';

interface GroupPageProps {
  currentMember: Member;
}

const PlusIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
  </svg>
);

const CloseIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const EditIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
  </svg>
);

const TrashIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
  </svg>
);

const SearchIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
  </svg>
);

const HeartIcon = ({ filled }: { filled: boolean }) => (
  <svg className="w-5 h-5" fill={filled ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
  </svg>
);

export function GroupPage({ currentMember }: GroupPageProps) {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<'communities' | 'search'>('communities');

  // Communities state
  const [communities, setCommunities] = useState<Community[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingCommunity, setEditingCommunity] = useState<Community | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchTab, setSearchTab] = useState<'users' | 'posts'>('users');
  const [users, setUsers] = useState<Member[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    fetchCommunities()
      .then(data => setCommunities(data.communities || []))
      .catch(e => console.error('Failed to load communities:', e))
      .finally(() => setLoading(false));
  }, []);

  // Handle search query parameter from URL (e.g., from mention links)
  useEffect(() => {
    const searchParam = searchParams.get('search');
    if (searchParam) {
      setActiveTab('search');
      setSearchQuery(searchParam);
      // Clear the URL param after reading
      setSearchParams({});
      // Perform search
      setSearching(true);
      setSearched(true);
      Promise.all([
        searchUsers(searchParam),
        searchPosts(searchParam),
      ]).then(([usersRes, postsRes]) => {
        setUsers(usersRes.users || []);
        setPosts(postsRes.posts || []);
      }).catch(e => {
        console.error('Search failed:', e);
      }).finally(() => {
        setSearching(false);
      });
    }
  }, [searchParams, setSearchParams]);

  const handleCreate = async () => {
    if (!name.trim() || creating) return;
    setCreating(true);
    try {
      const { community } = await createCommunity({ name: name.trim(), description: description.trim() || undefined });
      setCommunities(prev => [...prev, community]);
      setShowModal(false);
      setName('');
      setDescription('');
    } catch (e) {
      console.error('Failed to create community:', e);
    } finally {
      setCreating(false);
    }
  };

  const openEditModal = (community: Community, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setEditingCommunity(community);
    setName(community.name);
    setDescription(community.description || '');
    setShowEditModal(true);
  };

  const handleUpdate = async () => {
    if (!name.trim() || saving || !editingCommunity) return;
    setSaving(true);
    try {
      const { community } = await updateCommunity(editingCommunity.id, {
        name: name.trim(),
        description: description.trim() || undefined,
      });
      setCommunities(prev => prev.map(c => c.id === community.id ? community : c));
      setShowEditModal(false);
      setEditingCommunity(null);
      setName('');
      setDescription('');
    } catch (e) {
      console.error('Failed to update community:', e);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (community: Community, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`「${community.name}」を削除しますか？この操作は取り消せません。`)) return;
    try {
      await deleteCommunity(community.id);
      setCommunities(prev => prev.filter(c => c.id !== community.id));
    } catch (e) {
      console.error('Failed to delete community:', e);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setSearched(true);
    try {
      const [usersRes, postsRes] = await Promise.all([
        searchUsers(searchQuery.trim()),
        searchPosts(searchQuery.trim()),
      ]);
      setUsers(usersRes.users || []);
      setPosts(postsRes.posts || []);
    } catch (e) {
      console.error('Search failed:', e);
    } finally {
      setSearching(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  const handleLike = async (post: Post) => {
    try {
      if (post.liked) {
        await unlikePost(post.id);
        setPosts(prev => prev.map(p => p.id === post.id ? { ...p, liked: false, like_count: p.like_count - 1 } : p));
      } else {
        await likePost(post.id);
        setPosts(prev => prev.map(p => p.id === post.id ? { ...p, liked: true, like_count: p.like_count + 1 } : p));
      }
    } catch (e) {
      console.error('Failed to toggle like:', e);
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

  return (
    <div className="flex flex-col h-full">
      <header className="sticky top-0 bg-black/80 backdrop-blur-sm border-b border-neutral-900 z-10">
        <div className="flex items-center justify-between px-4 py-3">
          <h1 className="text-xl font-bold">{t('groups.title')}</h1>
          {activeTab === 'communities' && (
            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-2 px-3 py-1.5 bg-blue-500 hover:bg-blue-600 rounded-full text-sm font-medium transition-colors"
            >
              <PlusIcon />
              <span>{t('groups.create')}</span>
            </button>
          )}
        </div>
        {/* Tabs */}
        <div className="flex border-b border-neutral-900">
          <button
            onClick={() => setActiveTab('communities')}
            className={`flex-1 py-3 text-center font-medium relative ${activeTab === 'communities' ? 'text-white' : 'text-neutral-500'}`}
          >
            コミュニティ
            {activeTab === 'communities' && <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-20 h-1 bg-blue-500 rounded-full" />}
          </button>
          <button
            onClick={() => setActiveTab('search')}
            className={`flex-1 py-3 text-center font-medium relative ${activeTab === 'search' ? 'text-white' : 'text-neutral-500'}`}
          >
            検索
            {activeTab === 'search' && <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-1 bg-blue-500 rounded-full" />}
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        {/* Communities Tab */}
        {activeTab === 'communities' && (
          <>
            {loading ? (
              <div className="p-8 text-center text-neutral-500">{t('common.loading')}</div>
            ) : communities.length === 0 ? (
              <div className="p-8 text-center text-neutral-500">{t('groups.noGroups')}</div>
            ) : (
              <>
                <div className="p-4 text-sm text-neutral-500 border-b border-neutral-900">
                  コミュニティの投稿はホームタブから確認できます
                </div>
                {communities.map(community => (
                  <Link
                    key={community.id}
                    to={`/?community=${community.id}`}
                    className="flex items-center gap-3 px-4 py-3 border-b border-neutral-900 hover:bg-neutral-900/30 transition-colors"
                  >
                    <div className="w-12 h-12 rounded-lg bg-neutral-800 flex items-center justify-center text-xl">
                      {community.icon_url ? (
                        <img src={community.icon_url} alt="" className="w-full h-full rounded-lg object-cover" />
                      ) : (
                        community.name.charAt(0).toUpperCase()
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-white truncate">{community.name}</div>
                      {community.description && (
                        <div className="text-sm text-neutral-500 truncate">{community.description}</div>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={(e) => openEditModal(community, e)}
                        className="p-2 text-neutral-500 hover:text-white hover:bg-neutral-800 rounded-full transition-colors"
                        title="編集"
                      >
                        <EditIcon />
                      </button>
                      <button
                        onClick={(e) => handleDelete(community, e)}
                        className="p-2 text-neutral-500 hover:text-red-500 hover:bg-red-500/10 rounded-full transition-colors"
                        title="削除"
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </Link>
                ))}
              </>
            )}
          </>
        )}

        {/* Search Tab */}
        {activeTab === 'search' && (
          <>
            {/* Search Input */}
            <div className="p-4 border-b border-neutral-900">
              <div className="flex items-center gap-2 bg-neutral-900 rounded-full px-4 py-2">
                <SearchIcon />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="検索..."
                  className="flex-1 bg-transparent outline-none text-white placeholder-neutral-500"
                />
              </div>
            </div>

            {searched && (
              <div className="flex border-b border-neutral-900">
                <button
                  onClick={() => setSearchTab('users')}
                  className={`flex-1 py-3 text-center font-medium relative ${searchTab === 'users' ? 'text-white' : 'text-neutral-500'}`}
                >
                  ユーザー
                  {searchTab === 'users' && <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-1 bg-blue-500 rounded-full" />}
                </button>
                <button
                  onClick={() => setSearchTab('posts')}
                  className={`flex-1 py-3 text-center font-medium relative ${searchTab === 'posts' ? 'text-white' : 'text-neutral-500'}`}
                >
                  投稿
                  {searchTab === 'posts' && <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-1 bg-blue-500 rounded-full" />}
                </button>
              </div>
            )}

            {searching ? (
              <div className="p-8 text-center text-neutral-500">{t('common.loading')}</div>
            ) : !searched ? (
              <div className="p-8 text-center text-neutral-500">
                ユーザーや投稿を検索できます
              </div>
            ) : searchTab === 'users' ? (
              users.length === 0 ? (
                <div className="p-8 text-center text-neutral-500">ユーザーが見つかりません</div>
              ) : (
                users.map(user => (
                  <Link
                    key={user.id}
                    to={`/profile/${user.id}`}
                    className="flex items-center gap-3 px-4 py-3 border-b border-neutral-900 hover:bg-neutral-900/30 transition-colors"
                  >
                    <UserAvatar avatarUrl={user.avatar_url} name={user.display_name || user.username} size={48} />
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-white truncate">{user.display_name || user.username}</div>
                      <div className="text-neutral-500 truncate">@{user.username}</div>
                      {user.bio && <div className="text-sm text-neutral-400 truncate mt-1">{user.bio}</div>}
                    </div>
                  </Link>
                ))
              )
            ) : (
              posts.length === 0 ? (
                <div className="p-8 text-center text-neutral-500">投稿が見つかりません</div>
              ) : (
                posts.map(post => (
                  <div key={post.id} className="flex gap-3 px-4 py-3 border-b border-neutral-900 hover:bg-neutral-900/30 transition-colors">
                    <Link to={`/profile/${post.member_id}`}>
                      <UserAvatar avatarUrl={post.avatar_url} name={post.display_name || post.username} size={48} />
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
                        <PostContent content={post.content} className="text-[15px] text-neutral-200 mt-1" />
                      </Link>
                      <div className="flex items-center gap-6 mt-3">
                        <button
                          onClick={() => handleLike(post)}
                          className={`flex items-center gap-2 transition-colors ${post.liked ? 'text-pink-500' : 'text-neutral-500 hover:text-pink-500'}`}
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
              )
            )}
          </>
        )}
      </div>

      {/* Create Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-neutral-900 rounded-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
              <h2 className="text-lg font-bold">{t('groups.createTitle')}</h2>
              <button
                onClick={() => setShowModal(false)}
                className="p-1 hover:bg-neutral-800 rounded-full transition-colors"
              >
                <CloseIcon />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-sm text-neutral-400 mb-1">{t('groups.name')}</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder={t('groups.namePlaceholder')}
                  className="w-full bg-neutral-800 rounded-lg px-3 py-2 text-white placeholder-neutral-500 outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm text-neutral-400 mb-1">{t('groups.description')}</label>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder={t('groups.descriptionPlaceholder')}
                  rows={3}
                  className="w-full bg-neutral-800 rounded-lg px-3 py-2 text-white placeholder-neutral-500 outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-neutral-800">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 text-neutral-400 hover:text-white transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleCreate}
                disabled={!name.trim() || creating}
                className="px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-neutral-700 disabled:text-neutral-500 rounded-full font-medium transition-colors"
              >
                {creating ? t('common.loading') : t('groups.create')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {showEditModal && editingCommunity && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-neutral-900 rounded-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
              <h2 className="text-lg font-bold">コミュニティを編集</h2>
              <button
                onClick={() => {
                  setShowEditModal(false);
                  setEditingCommunity(null);
                  setName('');
                  setDescription('');
                }}
                className="p-1 hover:bg-neutral-800 rounded-full transition-colors"
              >
                <CloseIcon />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-sm text-neutral-400 mb-1">{t('groups.name')}</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder={t('groups.namePlaceholder')}
                  className="w-full bg-neutral-800 rounded-lg px-3 py-2 text-white placeholder-neutral-500 outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm text-neutral-400 mb-1">{t('groups.description')}</label>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder={t('groups.descriptionPlaceholder')}
                  rows={3}
                  className="w-full bg-neutral-800 rounded-lg px-3 py-2 text-white placeholder-neutral-500 outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-neutral-800">
              <button
                onClick={() => {
                  setShowEditModal(false);
                  setEditingCommunity(null);
                  setName('');
                  setDescription('');
                }}
                className="px-4 py-2 text-neutral-400 hover:text-white transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleUpdate}
                disabled={!name.trim() || saving}
                className="px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-neutral-700 disabled:text-neutral-500 rounded-full font-medium transition-colors"
              >
                {saving ? t('common.loading') : t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
