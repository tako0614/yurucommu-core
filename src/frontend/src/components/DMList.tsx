import { DMConversation } from '../types';
import { UserAvatar } from './UserAvatar';

interface DMListProps {
  conversations: DMConversation[];
  selectedId: string | null;
  onSelect: (conv: DMConversation) => void;
}

export function DMList({ conversations, selectedId, onSelect }: DMListProps) {
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      return date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    } else if (days === 1) {
      return 'Yesterday';
    } else if (days < 7) {
      return `${days}d ago`;
    }
    return date.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' });
  };

  const sortedConvs = [...conversations].sort((a, b) => {
    const aTime = a.last_message_at || a.created_at;
    const bTime = b.last_message_at || b.created_at;
    return new Date(bTime).getTime() - new Date(aTime).getTime();
  });

  return (
    <div className="flex-1 overflow-y-auto">
      {sortedConvs.map((conv) => (
        <div
          key={conv.id}
          onClick={() => onSelect(conv)}
          className={`px-4 py-3 flex items-center gap-3 cursor-pointer transition-colors border-b border-neutral-900 ${
            selectedId === conv.id
              ? 'bg-neutral-900'
              : 'hover:bg-neutral-900/50'
          }`}
        >
          <UserAvatar
            avatarUrl={conv.other_participant.icon_url}
            name={conv.other_participant.name || conv.other_participant.preferred_username}
            size={48}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <span className="font-bold text-white truncate">
                {conv.other_participant.name || conv.other_participant.preferred_username}
              </span>
              <span className="text-xs text-neutral-600">
                {formatDate(conv.last_message_at)}
              </span>
            </div>
            <span className="text-sm text-neutral-500 truncate">@{conv.other_participant.username}</span>
          </div>
        </div>
      ))}

      {conversations.length === 0 && (
        <div className="p-8 text-center text-neutral-500">
          No conversations yet
        </div>
      )}
    </div>
  );
}
