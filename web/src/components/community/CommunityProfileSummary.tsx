import { Show } from 'solid-js';
import { A } from '@solidjs/router';
import type { CommunityDetail } from '../../lib/api.ts';
import { formatMonthYear } from '../../lib/datetime.ts';
import { CalendarIcon, ChatIcon, UsersIcon } from './CommunityIcons.tsx';

type JoinPolicy = 'open' | 'approval' | 'invite';

type Visibility = 'public' | 'private';

interface CommunityProfileSummaryProps {
  community: CommunityDetail;
  joining: boolean;
  onJoin: () => void;
  onLeave: () => void;
  chatPath: string;
}

function getJoinButtonLabel(
  joinPolicy: JoinPolicy,
  joinStatus: 'pending' | null | undefined,
  joining: boolean
): string {
  if (joining) return '参加中...';
  if (joinStatus === 'pending') return '承認待ち';
  if (joinPolicy === 'invite') return '招待コードで参加';
  return '参加する';
}

export function CommunityProfileSummary(props: CommunityProfileSummaryProps) {
  const joinLabel = () => getJoinButtonLabel(props.community.join_policy, props.community.join_status, props.joining);
  const visibilityLabel = () => props.community.visibility === 'public' ? '公開' : '非公開';
  const joinPolicyLabel = () =>
    props.community.join_policy === 'open'
      ? '誰でも参加可能'
      : props.community.join_policy === 'approval'
        ? '承認制'
        : '招待制';

  return (
    <>
      {/* Header Image */}
      <div class="h-32 md:h-48 bg-gradient-to-br from-blue-600 to-purple-700 relative" />

      {/* Profile Info */}
      <div class="px-4 pb-4 relative">
        {/* Icon */}
        <div class="absolute -top-16 left-4">
          <div class="w-32 h-32 rounded-2xl border-4 border-black overflow-hidden bg-neutral-800 flex items-center justify-center">
            <Show
              when={props.community.icon_url}
              fallback={
                <span class="text-4xl font-bold text-white">
                  {(props.community.display_name || props.community.name).charAt(0).toUpperCase()}
                </span>
              }
            >
              <img src={props.community.icon_url} alt="" class="w-full h-full object-cover" />
            </Show>
          </div>
        </div>

        {/* Action Buttons */}
        <div class="flex justify-end pt-3 pb-12 gap-2">
          <Show
            when={props.community.is_member}
            fallback={
              <button
                onClick={props.onJoin}
                disabled={props.joining || props.community.join_status === 'pending'}
                class="px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-full font-bold transition-colors disabled:opacity-50"
              >
                {joinLabel()}
              </button>
            }
          >
            <A
              href={props.chatPath}
              class="flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-full font-bold transition-colors"
            >
              <ChatIcon />
              <span>トーク</span>
            </A>
            <button
              onClick={props.onLeave}
              disabled={props.joining}
              class="px-4 py-2 border border-neutral-600 text-white hover:border-red-500 hover:text-red-500 rounded-full font-bold transition-colors disabled:opacity-50"
            >
              退出
            </button>
          </Show>
        </div>

        {/* Name */}
        <div class="mb-3">
          <div class="text-xl font-bold text-white">{props.community.display_name || props.community.name}</div>
          <div class="text-neutral-500">@{props.community.name}</div>
        </div>

        {/* Summary */}
        <Show when={props.community.summary}>
          <p class="text-neutral-200 mb-3 whitespace-pre-wrap">{props.community.summary}</p>
        </Show>

        {/* Meta Info */}
        <div class="flex flex-wrap gap-4 text-neutral-500 text-sm mb-3">
          <div class="flex items-center gap-1">
            <UsersIcon />
            <span>{props.community.member_count} メンバー</span>
          </div>
          <div class="flex items-center gap-1">
            <CalendarIcon />
            <span>作成日 {formatMonthYear(props.community.created_at)}</span>
          </div>
        </div>

        {/* Visibility & Policy */}
        <div class="flex flex-wrap gap-2">
          <span
            class={`px-2 py-1 text-xs rounded-full ${
              props.community.visibility === 'public' ? 'bg-green-500/20 text-green-400' : 'bg-neutral-700 text-neutral-300'
            }`}
          >
            {visibilityLabel()}
          </span>
          <span class="px-2 py-1 text-xs rounded-full bg-neutral-700 text-neutral-300">
            {joinPolicyLabel()}
          </span>
        </div>
      </div>
    </>
  );
}
