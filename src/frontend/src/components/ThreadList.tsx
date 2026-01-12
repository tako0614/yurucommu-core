import { Thread } from '../types';
import { UserAvatar } from './UserAvatar';

interface ThreadListProps {
  threads: Thread[];
  onSelectThread: (thread: Thread) => void;
  onNewThread: () => void;
}

export function ThreadList({ threads, onSelectThread, onNewThread }: ThreadListProps) {
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

  // Sort: pinned first, then by last_reply_at
  const sortedThreads = [...threads].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const aTime = a.last_reply_at || a.created_at;
    const bTime = b.last_reply_at || b.created_at;
    return new Date(bTime).getTime() - new Date(aTime).getTime();
  });

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-4 border-b border-neutral-700 flex justify-between items-center">
        <h4 className="font-medium text-neutral-300">Threads</h4>
        <button
          onClick={onNewThread}
          className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-700 transition-colors"
        >
          New Thread
        </button>
      </div>

      <div className="divide-y divide-neutral-800">
        {sortedThreads.map((thread) => (
          <div
            key={thread.id}
            onClick={() => onSelectThread(thread)}
            className="p-4 hover:bg-neutral-800/50 cursor-pointer transition-colors"
          >
            <div className="flex items-start gap-3">
              <UserAvatar
                avatarUrl={thread.avatar_url}
                name={thread.display_name || thread.username}
                size="sm"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  {thread.pinned && (
                    <span className="text-yellow-500 text-xs" title="Pinned">
                      📌
                    </span>
                  )}
                  {thread.locked && (
                    <span className="text-red-500 text-xs" title="Locked">
                      🔒
                    </span>
                  )}
                  <h5 className="font-medium text-neutral-100 truncate">
                    {thread.title}
                  </h5>
                </div>
                <p className="text-sm text-neutral-500 truncate mt-1">
                  {thread.content || 'No content'}
                </p>
                <div className="flex items-center gap-3 mt-2 text-xs text-neutral-500">
                  <span>{thread.username}</span>
                  <span>·</span>
                  <span>{thread.reply_count} replies</span>
                  <span>·</span>
                  <span>{formatDate(thread.last_reply_at || thread.created_at)}</span>
                </div>
              </div>
            </div>
          </div>
        ))}

        {threads.length === 0 && (
          <div className="p-8 text-center text-neutral-500">
            No threads yet. Start a new discussion!
          </div>
        )}
      </div>
    </div>
  );
}
