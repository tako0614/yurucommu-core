import { Link } from 'react-router-dom';
import type { CommunityJoinRequest } from '../../lib/api';
import type { CommunityMember } from './types';
import { UserAvatar } from '../UserAvatar';

interface CommunityMembersPanelProps {
  members: CommunityMember[];
  joinRequests: CommunityJoinRequest[];
  canManage: boolean;
  isOwner: boolean;
  loadingRequests: boolean;
  requestAction: Record<string, boolean>;
  memberActionError: string | null;
  updatingMemberRole: Record<string, boolean>;
  inviteCode: string | null;
  creatingInvite: boolean;
  joinPolicy: string | undefined;
  actorApId: string;
  onAcceptRequest: (request: CommunityJoinRequest) => void;
  onRejectRequest: (request: CommunityJoinRequest) => void;
  onUpdateMemberRole: (member: CommunityMember, role: 'owner' | 'moderator' | 'member') => void;
  onCreateInvite: () => void;
  t: (key: string) => string;
}

export function CommunityMembersPanel({
  members,
  joinRequests,
  canManage,
  isOwner,
  loadingRequests,
  requestAction,
  memberActionError,
  updatingMemberRole,
  inviteCode,
  creatingInvite,
  joinPolicy,
  actorApId,
  onAcceptRequest,
  onRejectRequest,
  onUpdateMemberRole,
  onCreateInvite,
  t,
}: CommunityMembersPanelProps) {
  return (
    <div>
      {canManage && (
        <div className="border-b border-neutral-900">
          <div className="px-4 py-3">
            <div className="text-sm font-semibold text-neutral-400">Join Requests</div>
          </div>
          {loadingRequests ? (
            <div className="px-4 pb-4 text-sm text-neutral-500">Loading...</div>
          ) : joinRequests.length === 0 ? (
            <div className="px-4 pb-4 text-sm text-neutral-500">No pending requests</div>
          ) : (
            joinRequests.map((request) => (
              <div
                key={request.ap_id}
                className="flex items-center gap-3 px-4 py-3 border-t border-neutral-900"
              >
                <UserAvatar
                  avatarUrl={request.icon_url}
                  name={request.name || request.preferred_username}
                  size={40}
                />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-white truncate">
                    {request.name || request.preferred_username}
                  </div>
                  <div className="text-sm text-neutral-500 truncate">@{request.username}</div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => onAcceptRequest(request)}
                    disabled={requestAction[request.ap_id]}
                    className="px-3 py-1 text-xs bg-blue-500 text-white rounded-full hover:bg-blue-600 transition-colors disabled:opacity-50"
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => onRejectRequest(request)}
                    disabled={requestAction[request.ap_id]}
                    className="px-3 py-1 text-xs bg-neutral-800 text-neutral-200 rounded-full hover:bg-neutral-700 transition-colors disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}
      {memberActionError && (
        <div className="px-4 py-2 text-sm text-red-400 bg-red-500/10">
          {memberActionError}
        </div>
      )}
      {members.length === 0 ? (
        <div className="p-8 text-center text-neutral-500">メンバーがいません</div>
      ) : (
        members.map((member) => (
          <Link
            key={member.ap_id}
            to={`/profile/${encodeURIComponent(member.ap_id)}`}
            className="flex items-center gap-3 px-4 py-3 hover:bg-neutral-900/30 transition-colors"
          >
            <UserAvatar
              avatarUrl={member.icon_url}
              name={member.name || member.preferred_username}
              size={48}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-bold text-white truncate">
                  {member.name || member.preferred_username}
                </span>
                {member.role === 'owner' && (
                  <span className="px-1.5 py-0.5 text-xs bg-yellow-500/20 text-yellow-400 rounded">
                    オーナー
                  </span>
                )}
                {member.role === 'moderator' && (
                  <span className="px-1.5 py-0.5 text-xs bg-blue-500/20 text-blue-400 rounded">
                    モデレーター
                  </span>
                )}
              </div>
              <div className="text-neutral-500 truncate">@{member.username}</div>
            </div>
            {isOwner && member.ap_id !== actorApId && (
              <select
                value={member.role}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onChange={(e) => onUpdateMemberRole(member, e.target.value as 'owner' | 'moderator' | 'member')}
                disabled={updatingMemberRole[member.ap_id]}
                className="ml-auto bg-neutral-900 border border-neutral-700 text-xs text-white rounded-lg px-2 py-1"
              >
                <option value="member">{t('members.member')}</option>
                <option value="moderator">{t('members.moderator')}</option>
                <option value="owner">{t('members.owner')}</option>
              </select>
            )}
          </Link>
        ))
      )}
      {canManage && joinPolicy === 'invite' && (
        <div className="mt-4 p-3 bg-neutral-900/50 rounded-lg">
          <div className="text-sm font-semibold text-neutral-300 mb-2">Invite Code</div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={onCreateInvite}
              disabled={creatingInvite}
              className="px-3 py-1 text-xs bg-blue-500 text-white rounded-full hover:bg-blue-600 transition-colors disabled:opacity-50"
            >
              {creatingInvite ? 'Creating...' : 'Create'}
            </button>
            {inviteCode && (
              <span className="px-2 py-1 text-xs bg-neutral-800 text-neutral-200 rounded">
                {inviteCode}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
