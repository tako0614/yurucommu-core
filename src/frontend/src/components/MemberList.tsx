import { Member } from '../types';
import { UserAvatar } from './UserAvatar';

interface MemberListProps {
  members: Member[];
  currentMember: Member;
  onClose: () => void;
  onChangeRole: (memberId: string, role: string) => void;
  onRemoveMember: (memberId: string) => void;
  onStartDM?: (member: Member) => void;
}

export function MemberList({
  members,
  currentMember,
  onClose,
  onChangeRole,
  onRemoveMember,
  onStartDM,
}: MemberListProps) {
  return (
    <div className="w-70 bg-neutral-900 border-l border-neutral-700 flex flex-col">
      <div className="p-4 border-b border-neutral-700 flex items-center justify-between">
        <h3 className="text-base font-semibold text-neutral-100">メンバー ({members.length})</h3>
        <button
          className="bg-transparent border-none text-neutral-500 text-xl cursor-pointer px-2 py-1 hover:text-neutral-100"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {members.map(m => (
          <div key={m.id} className="flex items-center gap-3 p-3 rounded-md hover:bg-neutral-800">
            <UserAvatar avatarUrl={m.avatar_url} name={m.display_name || m.username} />
            <div className="flex-1 min-w-0">
              <div className="font-medium text-neutral-100 overflow-hidden text-ellipsis whitespace-nowrap flex items-center gap-2">
                {m.display_name || m.username}
                {m.is_remote && (
                  <span className="text-xs px-1.5 py-0.5 bg-blue-900/50 text-blue-300 rounded" title={m.ap_actor_id || undefined}>
                    🌐
                  </span>
                )}
              </div>
              <div className="text-sm text-neutral-500 mt-0.5">
                {m.role === 'owner' && '👑 オーナー'}
                {m.role === 'moderator' && '🛡️ モデレーター'}
                {m.role === 'member' && (m.is_remote ? '🌐 リモート' : 'メンバー')}
              </div>
            </div>
            {/* Role management for owners */}
            {currentMember.role === 'owner' && m.id !== currentMember.id && (
              <div className="flex items-center gap-2">
                <select
                  value={m.role}
                  onChange={e => onChangeRole(m.id, e.target.value)}
                  className="bg-neutral-800 border border-neutral-700 text-neutral-100 px-2 py-1 rounded text-sm cursor-pointer hover:border-neutral-600"
                >
                  <option value="member">メンバー</option>
                  <option value="moderator">モデレーター</option>
                  <option value="owner">オーナー</option>
                </select>
                {m.role !== 'owner' && (
                  <button
                    className="bg-transparent border-none p-1 cursor-pointer text-base opacity-60 hover:opacity-100"
                    onClick={() => onRemoveMember(m.id)}
                    title="削除"
                  >
                    🗑️
                  </button>
                )}
              </div>
            )}
            {/* Remove option for moderators */}
            {currentMember.role === 'moderator' && m.role === 'member' && m.id !== currentMember.id && (
              <button
                className="bg-transparent border-none p-1 cursor-pointer text-base opacity-60 hover:opacity-100"
                onClick={() => onRemoveMember(m.id)}
                title="削除"
              >
                🗑️
              </button>
            )}
            {/* DM button */}
            {onStartDM && m.id !== currentMember.id && (
              <button
                className="bg-transparent border-none p-1 cursor-pointer text-base opacity-60 hover:opacity-100"
                onClick={() => onStartDM(m)}
                title="DM"
              >
                💬
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
