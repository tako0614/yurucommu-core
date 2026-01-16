import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Actor } from '../types';
import { CommunityDetail, fetchCommunities, createCommunity, joinCommunity } from '../lib/api';
import { UserAvatar } from '../components/UserAvatar';

interface GroupsPageProps {
  actor: Actor;
}

const PlusIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
  </svg>
);

const ChevronRightIcon = () => (
  <svg className="w-5 h-5 text-neutral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
  </svg>
);

const CloseIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const UsersIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
  </svg>
);

function CreateCommunityModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (community: CommunityDetail) => void;
}) {
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [summary, setSummary] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const namePattern = /^[a-zA-Z0-9_]+$/;
  const trimmedName = name.trim();
  const isNameValid = trimmedName.length >= 2 && namePattern.test(trimmedName);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!trimmedName) {
      setError('Group ID is required');
      return;
    }
    if (trimmedName.length < 2) {
      setError('Group ID must be at least 2 characters');
      return;
    }
    if (!namePattern.test(trimmedName)) {
      setError('Use letters, numbers, and underscores only');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const community = await createCommunity({
        name: trimmedName,
        display_name: displayName.trim() || undefined,
        summary: summary.trim() || undefined,
      });
      onCreate(community);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create community');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
      <div className="bg-neutral-900 rounded-xl w-full max-w-md">
        <div className="flex items-center justify-between p-4 border-b border-neutral-800">
          <h2 className="text-lg font-bold text-white">グループを作成</h2>
          <button onClick={onClose} aria-label="Close" className="text-neutral-400 hover:text-white">
            <CloseIcon />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="block text-sm text-neutral-400 mb-1">グループID（必須）</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my_group"
              minLength={2}
              pattern="^[a-zA-Z0-9_]+$"
              className="w-full bg-neutral-800 text-white rounded-lg px-4 py-2 outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
            <p className="text-xs text-neutral-500 mt-1">英数字とアンダースコアのみ</p>
          </div>

          <div>
            <label className="block text-sm text-neutral-400 mb-1">表示名</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="マイグループ"
              className="w-full bg-neutral-800 text-white rounded-lg px-4 py-2 outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm text-neutral-400 mb-1">説明</label>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="グループの説明..."
              rows={3}
              className="w-full bg-neutral-800 text-white rounded-lg px-4 py-2 outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          {error && (
            <div className="text-red-400 text-sm bg-red-900/20 px-3 py-2 rounded-lg">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !isNameValid}
            className="w-full bg-blue-500 text-white font-medium py-2 rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50"
          >
            {loading ? '作成中...' : '作成'}
          </button>
        </form>
      </div>
    </div>
  );
}

export function GroupsPage({ actor }: GroupsPageProps) {
  const [communities, setCommunities] = useState<CommunityDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);

  useEffect(() => {
    loadCommunities();
  }, []);

  const loadCommunities = async () => {
    try {
      const data = await fetchCommunities();
      setCommunities(data);
    } catch (e) {
      console.error('Failed to load communities:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = async (community: CommunityDetail, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      let inviteId: string | undefined;
      if (community.join_policy === 'invite') {
        const input = window.prompt('Invite code');
        if (!input) return;
        inviteId = input.trim();
      }
      const result = await joinCommunity(community.name, { inviteId });
      setCommunities(prev =>
        prev.map(c => {
          if (c.ap_id !== community.ap_id) return c;
          if (result.status === 'pending') {
            return { ...c, join_status: 'pending' };
          }
          return { ...c, is_member: true, join_status: null, member_count: c.member_count + 1 };
        })
      );
    } catch (err) {
      console.error('Failed to join:', err);
    }
  };

  const handleCreate = (community: CommunityDetail) => {
    setCommunities(prev => [community, ...prev]);
  };

  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      return date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    } else if (days === 1) {
      return '昨日';
    } else if (days < 7) {
      return `${days}日前`;
    }
    return date.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' });
  };

  // Separate my communities and other communities
  const myCommunities = communities.filter(c => c.is_member);
  const otherCommunities = communities.filter(c => !c.is_member);

  return (
    <div className="flex flex-col h-full bg-black">
      {/* Header */}
      <header className="sticky top-0 bg-black/80 backdrop-blur-sm z-10">
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-900">
          <h1 className="text-xl font-bold text-white">グループ</h1>
          <button
            onClick={() => setShowCreateModal(true)}
            aria-label="Create group"
            className="p-2 text-neutral-400 hover:text-white transition-colors"
          >
            <PlusIcon />
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-8 text-center text-neutral-500">読み込み中...</div>
        ) : communities.length === 0 ? (
          <div className="p-8 text-center">
            <div className="text-neutral-500 mb-4">グループがありません</div>
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-6 py-2 bg-blue-500 text-white font-medium rounded-full hover:bg-blue-600 transition-colors"
            >
              グループを作成
            </button>
          </div>
        ) : (
          <>
            {/* My Communities */}
            {myCommunities.length > 0 && (
              <>
                <div className="px-4 py-2 text-sm text-neutral-500 bg-neutral-900/30">
                  参加中のグループ
                </div>
                {myCommunities.map(community => (
                  <Link
                    key={community.ap_id}
                    to={`/groups/${community.name}`}
                    className="flex items-center gap-3 px-4 py-3 border-b border-neutral-900 hover:bg-neutral-900/30 transition-colors"
                  >
                    <div className="w-14 h-14 rounded-full bg-neutral-800 flex items-center justify-center overflow-hidden">
                      {community.icon_url ? (
                        <img src={community.icon_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-xl font-medium text-white">
                          {(community.display_name || community.name).charAt(0).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-white truncate">
                          {community.display_name || community.name}
                        </span>
                        <span className="text-xs text-neutral-500 ml-2 flex-shrink-0">
                          {formatDate(community.last_message_at)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-neutral-500 mt-0.5">
                        <UsersIcon />
                        <span>{community.member_count}人</span>
                        {community.member_role === 'owner' && (
                          <span className="px-1.5 py-0.5 text-xs bg-yellow-500/20 text-yellow-400 rounded">
                            オーナー
                          </span>
                        )}
                        {community.member_role === 'moderator' && (
                          <span className="px-1.5 py-0.5 text-xs bg-blue-500/20 text-blue-400 rounded">
                            モデレーター
                          </span>
                        )}
                      </div>
                    </div>
                    <ChevronRightIcon />
                  </Link>
                ))}
              </>
            )}

            {/* Other Communities */}
            {otherCommunities.length > 0 && (
              <>
                <div className="px-4 py-2 text-sm text-neutral-500 bg-neutral-900/30">
                  その他のグループ
                </div>
                {otherCommunities.map(community => (
                  <div
                    key={community.ap_id}
                    className="flex items-center gap-3 px-4 py-3 border-b border-neutral-900"
                  >
                    <div className="w-14 h-14 rounded-full bg-neutral-800 flex items-center justify-center overflow-hidden">
                      {community.icon_url ? (
                        <img src={community.icon_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-xl font-medium text-white">
                          {(community.display_name || community.name).charAt(0).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-white truncate">
                        {community.display_name || community.name}
                      </div>
                      <div className="flex items-center gap-2 text-sm text-neutral-500 mt-0.5">
                        <UsersIcon />
                        <span>{community.member_count}人</span>
                      </div>
                    </div>
                    <button
                      onClick={(e) => handleJoin(community, e)}
                      disabled={community.join_status === 'pending'}
                      className="px-4 py-1.5 bg-blue-500 text-white font-medium rounded-full hover:bg-blue-600 transition-colors text-sm disabled:opacity-50"
                    >
                      {community.join_status === 'pending'
                        ? '承認待ち'
                        : community.join_policy === 'invite'
                          ? '招待コードで参加'
                          : '参加'}
                    </button>
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <CreateCommunityModal
          onClose={() => setShowCreateModal(false)}
          onCreate={handleCreate}
        />
      )}
    </div>
  );
}
