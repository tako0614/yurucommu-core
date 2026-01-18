import { Link } from 'react-router-dom';
import type { Actor } from '../../types';
import { UserAvatar } from '../UserAvatar';
import { CloseIcon } from './ProfileIcons';
import type { Translate } from '../../lib/i18n';

type FollowModalType = 'followers' | 'following' | null;

interface ProfileFollowModalProps {
  type: FollowModalType;
  actors: Actor[];
  loading: boolean;
  onClose: () => void;
  t: Translate;
}

export function ProfileFollowModal({ type, actors, loading, onClose, t }: ProfileFollowModalProps) {
  if (!type) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-neutral-900 rounded-2xl w-full max-w-md max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
          <div className="flex items-center gap-4">
            <button onClick={onClose} aria-label="Close" className="p-1 hover:bg-neutral-800 rounded-full transition-colors">
              <CloseIcon />
            </button>
            <h2 className="text-lg font-bold">
              {type === 'followers' ? t('profile.followers') : t('profile.following')}
            </h2>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-8 text-center text-neutral-500">{t('common.loading')}</div>
          ) : actors.length === 0 ? (
            <div className="p-8 text-center text-neutral-500">
              {type === 'followers' ? 'No followers yet' : 'Not following anyone'}
            </div>
          ) : (
            actors.map((actor) => (
              <Link
                key={actor.ap_id}
                to={`/profile/${encodeURIComponent(actor.ap_id)}`}
                onClick={onClose}
                className="flex items-center gap-3 px-4 py-3 hover:bg-neutral-800 transition-colors"
              >
                <UserAvatar avatarUrl={actor.icon_url} name={actor.name || actor.preferred_username} size={48} />
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-white truncate">{actor.name || actor.preferred_username}</div>
                  <div className="text-neutral-500 truncate">@{actor.username}</div>
                </div>
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
