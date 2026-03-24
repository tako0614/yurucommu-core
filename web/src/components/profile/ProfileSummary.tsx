import type { Actor } from '../../types';
import { formatMonthYear } from '../../lib/datetime';
import { UserAvatar } from '../UserAvatar';
import { CalendarIcon, MoreIcon } from './ProfileIcons';
import type { Translate } from '../../lib/i18n';

type FollowModalType = 'followers' | 'following';

interface ProfileSummaryProps {
  profile: Actor;
  isOwnProfile: boolean;
  isFollowing: boolean;
  showMenu: boolean;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onToggleFollow: () => void;
  onOpenEdit: () => void;
  onOpenFollowModal: (type: FollowModalType) => void;
  t: Translate;
}

export function ProfileSummary({
  profile,
  isOwnProfile,
  isFollowing,
  showMenu,
  onToggleMenu,
  onCloseMenu,
  onToggleFollow,
  onOpenEdit,
  onOpenFollowModal,
  t,
}: ProfileSummaryProps) {
  return (
    <>
      {/* Header Image */}
      <div className="h-32 md:h-48 bg-neutral-800 relative">
        {profile.header_url && <img src={profile.header_url} alt="" className="w-full h-full object-cover" />}
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
                  onClick={onToggleMenu}
                  aria-label="More options"
                  className="p-2 border border-neutral-600 rounded-full hover:bg-neutral-900 transition-colors"
                >
                  <MoreIcon />
                </button>
                {showMenu && (
                  <div className="absolute right-0 top-full mt-1 bg-neutral-900 rounded-xl shadow-lg py-1 min-w-[180px] z-20 border border-neutral-800">
                    <button
                      onClick={onCloseMenu}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-neutral-800 transition-colors"
                    >
                      Report
                    </button>
                  </div>
                )}
              </div>
              <button
                onClick={onToggleFollow}
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
              onClick={onOpenEdit}
              className="px-4 py-2 rounded-full font-bold border border-neutral-600 text-white hover:bg-neutral-900 transition-colors"
            >
              {t('profile.editProfile')}
            </button>
          )}
        </div>

        {/* Name & Username */}
        <div className="mb-3">
          <div className="text-xl font-bold text-white">{profile.name || profile.preferred_username}</div>
          <div className="text-neutral-500">@{profile.username}</div>
        </div>

        {/* Bio */}
        {profile.summary && <p className="text-neutral-200 mb-3 whitespace-pre-wrap">{profile.summary}</p>}

        {/* Join Date */}
        <div className="flex items-center gap-1 text-neutral-500 text-sm mb-3">
          <CalendarIcon />
          <span>Joined {formatMonthYear(profile.created_at)}</span>
        </div>

        {/* Follow Stats */}
        <div className="flex gap-4 text-sm">
          <button onClick={() => onOpenFollowModal('following')} className="hover:underline">
            <span className="font-bold text-white">{profile.following_count}</span>
            <span className="text-neutral-500 ml-1">{t('profile.following')}</span>
          </button>
          <button onClick={() => onOpenFollowModal('followers')} className="hover:underline">
            <span className="font-bold text-white">{profile.follower_count}</span>
            <span className="text-neutral-500 ml-1">{t('profile.followers')}</span>
          </button>
        </div>
      </div>
    </>
  );
}
