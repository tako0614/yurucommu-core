import { Show } from 'solid-js';
import type { Actor } from '../../types/index.ts';
import { formatMonthYear } from '../../lib/datetime.ts';
import { UserAvatar } from '../UserAvatar.tsx';
import { CalendarIcon, MoreIcon } from './ProfileIcons.tsx';
import type { Translate } from '../../lib/i18n.tsx';

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

export function ProfileSummary(props: ProfileSummaryProps) {
  return (
    <>
      {/* Header Image */}
      <div class="h-32 md:h-48 bg-neutral-800 relative">
        <Show when={props.profile.header_url}>
          <img src={props.profile.header_url} alt="" class="w-full h-full object-cover" />
        </Show>
      </div>

      {/* Profile Info */}
      <div class="px-4 pb-4 relative">
        {/* Avatar */}
        <div class="absolute -top-16 left-4">
          <div class="w-32 h-32 rounded-full border-4 border-black overflow-hidden bg-neutral-800">
            <UserAvatar
              avatarUrl={props.profile.icon_url}
              name={props.profile.name || props.profile.preferred_username}
              size={128}
            />
          </div>
        </div>

        {/* Follow Button & Menu */}
        <div class="flex justify-end pt-3 pb-12 gap-2">
          <Show when={!props.isOwnProfile}>
            <div class="relative">
              <button
                onClick={props.onToggleMenu}
                aria-label="More options"
                class="p-2 border border-neutral-600 rounded-full hover:bg-neutral-900 transition-colors"
              >
                <MoreIcon />
              </button>
              <Show when={props.showMenu}>
                <div class="absolute right-0 top-full mt-1 bg-neutral-900 rounded-xl shadow-lg py-1 min-w-[180px] z-20 border border-neutral-800">
                  <button
                    onClick={props.onCloseMenu}
                    class="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-neutral-800 transition-colors"
                  >
                    Report
                  </button>
                </div>
              </Show>
            </div>
            <button
              onClick={props.onToggleFollow}
              class={`px-4 py-2 rounded-full font-bold transition-colors ${
                props.isFollowing
                  ? 'bg-transparent border border-neutral-600 text-white hover:border-red-500 hover:text-red-500'
                  : 'bg-white text-black hover:bg-neutral-200'
              }`}
            >
              {props.isFollowing ? props.t('profile.unfollow') : props.t('profile.follow')}
            </button>
          </Show>
          <Show when={props.isOwnProfile}>
            <button
              onClick={props.onOpenEdit}
              class="px-4 py-2 rounded-full font-bold border border-neutral-600 text-white hover:bg-neutral-900 transition-colors"
            >
              {props.t('profile.editProfile')}
            </button>
          </Show>
        </div>

        {/* Name & Username */}
        <div class="mb-3">
          <div class="text-xl font-bold text-white">{props.profile.name || props.profile.preferred_username}</div>
          <div class="text-neutral-500">@{props.profile.username}</div>
        </div>

        {/* Bio */}
        <Show when={props.profile.summary}>
          <p class="text-neutral-200 mb-3 whitespace-pre-wrap">{props.profile.summary}</p>
        </Show>

        {/* Join Date */}
        <div class="flex items-center gap-1 text-neutral-500 text-sm mb-3">
          <CalendarIcon />
          <span>Joined {formatMonthYear(props.profile.created_at)}</span>
        </div>

        {/* Follow Stats */}
        <div class="flex gap-4 text-sm">
          <button onClick={() => props.onOpenFollowModal('following')} class="hover:underline">
            <span class="font-bold text-white">{props.profile.following_count}</span>
            <span class="text-neutral-500 ml-1">{props.t('profile.following')}</span>
          </button>
          <button onClick={() => props.onOpenFollowModal('followers')} class="hover:underline">
            <span class="font-bold text-white">{props.profile.follower_count}</span>
            <span class="text-neutral-500 ml-1">{props.t('profile.followers')}</span>
          </button>
        </div>
      </div>
    </>
  );
}
