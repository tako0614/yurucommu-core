import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useRequiredActor } from '../../hooks/useRequiredActor';
import type { RecommendedUser } from '../../lib/api/recommendations';
import { fetchRecommendedUsers, follow } from '../../lib/api';
import { UserAvatar } from '../UserAvatar';
import { PluginSlot } from '../PluginSlot';

function RecommendedUserCard({
  user,
  onFollowed,
}: {
  user: RecommendedUser;
  onFollowed: (apId: string) => void;
}) {
  const [following, setFollowing] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleFollow = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (loading || following) return;

    setLoading(true);
    try {
      await follow(user.ap_id);
      setFollowing(true);
      setTimeout(() => onFollowed(user.ap_id), 600);
    } catch {
      // Silent fail for non-critical feature
    } finally {
      setLoading(false);
    }
  };

  return (
    <Link
      to={`/profile/${encodeURIComponent(user.ap_id)}`}
      className="flex items-center gap-3 px-4 py-3 hover:bg-neutral-800/50 transition-colors"
    >
      <UserAvatar
        avatarUrl={user.icon_url}
        name={user.name || user.preferred_username}
        size="small"
      />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-bold text-white truncate">
          {user.name || user.preferred_username}
        </div>
        <div className="text-xs text-neutral-500 truncate">@{user.username}</div>
      </div>
      <button
        onClick={handleFollow}
        disabled={loading || following}
        className={`px-3 py-1 rounded-full text-xs font-bold transition-colors shrink-0 ${
          following
            ? 'bg-transparent text-neutral-500 border border-neutral-700'
            : 'bg-white text-black hover:bg-neutral-200'
        }`}
      >
        {following ? 'フォロー中' : 'フォロー'}
      </button>
    </Link>
  );
}

export function RightSidebar() {
  const actor = useRequiredActor();
  const [users, setUsers] = useState<RecommendedUser[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchRecommendedUsers()
      .then((data) => {
        if (!cancelled) setUsers(data);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [actor.ap_id]);

  const handleFollowed = useCallback((apId: string) => {
    setUsers((prev) => prev.filter((u) => u.ap_id !== apId));
  }, []);

  const showRecommendations = loading || users.length > 0;

  return (
    <div className="sticky top-0">
      {showRecommendations && (
        <div className="p-4 pb-0">
          <div className="bg-neutral-900/50 rounded-2xl overflow-hidden">
            <h2 className="text-lg font-bold px-4 pt-4 pb-2">おすすめユーザー</h2>
            {loading ? (
              <div className="px-4 py-6 text-center text-sm text-neutral-500">
                読み込み中...
              </div>
            ) : (
              <>
                {users.map((user) => (
                  <RecommendedUserCard
                    key={user.ap_id}
                    user={user}
                    onFollowed={handleFollowed}
                  />
                ))}
              </>
            )}
          </div>
        </div>
      )}
      <PluginSlot name="right-sidebar.below-recommendations" />
    </div>
  );
}
