import { Link } from 'react-router-dom';
import type { CommunityDetail } from '../../lib/api';
import { formatMonthYear } from '../../lib/datetime';
import { CalendarIcon, ChatIcon, UsersIcon } from './CommunityIcons';

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

export function CommunityProfileSummary({
  community,
  joining,
  onJoin,
  onLeave,
  chatPath,
}: CommunityProfileSummaryProps) {
  const joinLabel = getJoinButtonLabel(community.join_policy, community.join_status, joining);
  const visibilityLabel = community.visibility === 'public' ? '公開' : '非公開';
  const joinPolicyLabel =
    community.join_policy === 'open'
      ? '誰でも参加可能'
      : community.join_policy === 'approval'
        ? '承認制'
        : '招待制';

  return (
    <>
      {/* Header Image */}
      <div className="h-32 md:h-48 bg-gradient-to-br from-blue-600 to-purple-700 relative" />

      {/* Profile Info */}
      <div className="px-4 pb-4 relative">
        {/* Icon */}
        <div className="absolute -top-16 left-4">
          <div className="w-32 h-32 rounded-2xl border-4 border-black overflow-hidden bg-neutral-800 flex items-center justify-center">
            {community.icon_url ? (
              <img src={community.icon_url} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="text-4xl font-bold text-white">
                {(community.display_name || community.name).charAt(0).toUpperCase()}
              </span>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex justify-end pt-3 pb-12 gap-2">
          {community.is_member ? (
            <>
              <Link
                to={chatPath}
                className="flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-full font-bold transition-colors"
              >
                <ChatIcon />
                <span>トーク</span>
              </Link>
              <button
                onClick={onLeave}
                disabled={joining}
                className="px-4 py-2 border border-neutral-600 text-white hover:border-red-500 hover:text-red-500 rounded-full font-bold transition-colors disabled:opacity-50"
              >
                退出
              </button>
            </>
          ) : (
            <button
              onClick={onJoin}
              disabled={joining || community.join_status === 'pending'}
              className="px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-full font-bold transition-colors disabled:opacity-50"
            >
              {joinLabel}
            </button>
          )}
        </div>

        {/* Name */}
        <div className="mb-3">
          <div className="text-xl font-bold text-white">{community.display_name || community.name}</div>
          <div className="text-neutral-500">@{community.name}</div>
        </div>

        {/* Summary */}
        {community.summary && (
          <p className="text-neutral-200 mb-3 whitespace-pre-wrap">{community.summary}</p>
        )}

        {/* Meta Info */}
        <div className="flex flex-wrap gap-4 text-neutral-500 text-sm mb-3">
          <div className="flex items-center gap-1">
            <UsersIcon />
            <span>{community.member_count} メンバー</span>
          </div>
          <div className="flex items-center gap-1">
            <CalendarIcon />
            <span>作成日 {formatMonthYear(community.created_at)}</span>
          </div>
        </div>

        {/* Visibility & Policy */}
        <div className="flex flex-wrap gap-2">
          <span
            className={`px-2 py-1 text-xs rounded-full ${
              community.visibility === 'public' ? 'bg-green-500/20 text-green-400' : 'bg-neutral-700 text-neutral-300'
            }`}
          >
            {visibilityLabel}
          </span>
          <span className="px-2 py-1 text-xs rounded-full bg-neutral-700 text-neutral-300">
            {joinPolicyLabel}
          </span>
        </div>
      </div>
    </>
  );
}
