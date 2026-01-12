import { useState, useEffect, useRef, FormEvent } from 'react';
import { Thread, ThreadReply, Member } from '../types';
import { UserAvatar } from './UserAvatar';
import { fetchThreadReplies, createThreadReply, deleteThreadReply, pinThread, lockThread, deleteThread } from '../lib/api';

interface ThreadViewProps {
  thread: Thread;
  roomId: string;
  currentMember: Member;
  onBack: () => void;
  onThreadUpdated: () => void;
}

export function ThreadView({ thread, roomId, currentMember, onBack, onThreadUpdated }: ThreadViewProps) {
  const [replies, setReplies] = useState<ThreadReply[]>([]);
  const [newReply, setNewReply] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const isOwnerOrMod = currentMember.role === 'owner' || currentMember.role === 'moderator';
  const isAuthor = thread.member_id === currentMember.id;

  useEffect(() => {
    loadReplies();
    const interval = setInterval(loadReplies, 5000);
    return () => clearInterval(interval);
  }, [thread.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [replies]);

  const loadReplies = async () => {
    try {
      const data = await fetchThreadReplies(thread.id);
      setReplies(data.replies || []);
    } catch (e) {
      console.error('Failed to load replies:', e);
    }
  };

  const handleSubmitReply = async (e: FormEvent) => {
    e.preventDefault();
    if (!newReply.trim() || submitting || thread.locked) return;

    setSubmitting(true);
    try {
      const reply = await createThreadReply(thread.id, newReply.trim());
      setReplies((prev) => [...prev, reply]);
      setNewReply('');
    } catch (e) {
      console.error('Failed to post reply:', e);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteReply = async (replyId: string) => {
    if (!confirm('Delete this reply?')) return;
    try {
      await deleteThreadReply(thread.id, replyId);
      setReplies((prev) => prev.filter((r) => r.id !== replyId));
    } catch (e) {
      console.error('Failed to delete reply:', e);
    }
  };

  const handleTogglePin = async () => {
    try {
      await pinThread(roomId, thread.id, !thread.pinned);
      onThreadUpdated();
    } catch (e) {
      console.error('Failed to toggle pin:', e);
    }
  };

  const handleToggleLock = async () => {
    try {
      await lockThread(roomId, thread.id, !thread.locked);
      onThreadUpdated();
    } catch (e) {
      console.error('Failed to toggle lock:', e);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Delete this thread and all replies?')) return;
    try {
      await deleteThread(roomId, thread.id);
      onBack();
      onThreadUpdated();
    } catch (e) {
      console.error('Failed to delete thread:', e);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('ja-JP', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-neutral-700 bg-neutral-900">
        <div className="flex items-center gap-3 mb-2">
          <button
            onClick={onBack}
            className="text-neutral-400 hover:text-neutral-100 transition-colors"
          >
            ← Back
          </button>
          <div className="flex-1" />
          {isOwnerOrMod && (
            <>
              <button
                onClick={handleTogglePin}
                className={`px-2 py-1 rounded text-xs ${
                  thread.pinned ? 'bg-yellow-600 text-white' : 'bg-neutral-700 text-neutral-300'
                } hover:opacity-80`}
              >
                {thread.pinned ? 'Unpin' : 'Pin'}
              </button>
              <button
                onClick={handleToggleLock}
                className={`px-2 py-1 rounded text-xs ${
                  thread.locked ? 'bg-red-600 text-white' : 'bg-neutral-700 text-neutral-300'
                } hover:opacity-80`}
              >
                {thread.locked ? 'Unlock' : 'Lock'}
              </button>
            </>
          )}
          {(isOwnerOrMod || isAuthor) && (
            <button
              onClick={handleDelete}
              className="px-2 py-1 rounded text-xs bg-red-700 text-white hover:bg-red-800"
            >
              Delete
            </button>
          )}
        </div>

        <div className="flex items-start gap-3">
          <UserAvatar
            avatarUrl={thread.avatar_url}
            name={thread.display_name || thread.username}
          />
          <div>
            <div className="flex items-center gap-2">
              {thread.pinned && <span className="text-yellow-500">📌</span>}
              {thread.locked && <span className="text-red-500">🔒</span>}
              <h3 className="text-lg font-semibold">{thread.title}</h3>
            </div>
            <p className="text-sm text-neutral-500">
              {thread.display_name || thread.username} · {formatDate(thread.created_at)}
            </p>
          </div>
        </div>

        {thread.content && (
          <p className="mt-4 text-neutral-200 whitespace-pre-wrap">{thread.content}</p>
        )}
      </div>

      {/* Replies */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {replies.map((reply) => (
          <div key={reply.id} className="flex gap-3 group">
            <UserAvatar
              avatarUrl={reply.avatar_url}
              name={reply.display_name || reply.username}
              size="sm"
            />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">
                  {reply.display_name || reply.username}
                </span>
                <span className="text-xs text-neutral-500">{formatDate(reply.created_at)}</span>
                {(isOwnerOrMod || reply.member_id === currentMember.id) && (
                  <button
                    onClick={() => handleDeleteReply(reply.id)}
                    className="text-xs text-red-500 opacity-0 group-hover:opacity-100 transition-opacity hover:text-red-400"
                  >
                    Delete
                  </button>
                )}
              </div>
              <p className="text-neutral-200 mt-1 whitespace-pre-wrap">{reply.content}</p>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Reply input */}
      {!thread.locked ? (
        <form onSubmit={handleSubmitReply} className="p-4 border-t border-neutral-700 bg-neutral-900">
          <div className="flex gap-2">
            <input
              type="text"
              value={newReply}
              onChange={(e) => setNewReply(e.target.value)}
              placeholder="Write a reply..."
              className="flex-1 bg-neutral-800 border border-neutral-700 rounded-md px-4 py-2 text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={submitting}
            />
            <button
              type="submit"
              disabled={!newReply.trim() || submitting}
              className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Reply
            </button>
          </div>
        </form>
      ) : (
        <div className="p-4 border-t border-neutral-700 bg-neutral-900 text-center text-neutral-500">
          This thread is locked
        </div>
      )}
    </div>
  );
}
