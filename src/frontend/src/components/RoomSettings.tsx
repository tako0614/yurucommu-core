import { useState, FormEvent } from 'react';
import { Room } from '../types';

interface RoomSettingsProps {
  room: Room;
  onClose: () => void;
  onSave: (data: { name?: string; description?: string; kind?: 'chat' | 'forum'; join_policy?: 'open' | 'inviteOnly' | 'moderated' }) => Promise<void>;
}

export function RoomSettings({ room, onClose, onSave }: RoomSettingsProps) {
  const [name, setName] = useState(room.name);
  const [description, setDescription] = useState(room.description || '');
  const [kind, setKind] = useState<'chat' | 'forum'>(room.kind);
  const [joinPolicy, setJoinPolicy] = useState<'open' | 'inviteOnly' | 'moderated'>(room.join_policy || 'open');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || submitting) return;

    setSubmitting(true);
    try {
      await onSave({
        name: name.trim(),
        description: description.trim() || undefined,
        kind,
        join_policy: joinPolicy,
      });
      onClose();
    } catch (e) {
      console.error('Failed to save room settings:', e);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-neutral-900 border border-neutral-700 rounded-lg w-full max-w-md mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-neutral-700 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Room Settings</h3>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-100">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label htmlFor="room-name" className="block text-sm font-medium text-neutral-300 mb-1">
              Name
            </label>
            <input
              id="room-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-neutral-800 border border-neutral-700 rounded-md px-4 py-2 text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={submitting}
            />
          </div>

          <div>
            <label htmlFor="room-description" className="block text-sm font-medium text-neutral-300 mb-1">
              Description
            </label>
            <textarea
              id="room-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full h-20 bg-neutral-800 border border-neutral-700 rounded-md px-4 py-2 text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              disabled={submitting}
            />
          </div>

          <div>
            <label htmlFor="room-kind" className="block text-sm font-medium text-neutral-300 mb-1">
              Type
            </label>
            <select
              id="room-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as 'chat' | 'forum')}
              className="w-full bg-neutral-800 border border-neutral-700 rounded-md px-4 py-2 text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={submitting}
            >
              <option value="chat">Chat (real-time messages)</option>
              <option value="forum">Forum (threaded discussions)</option>
            </select>
          </div>

          <div>
            <label htmlFor="room-policy" className="block text-sm font-medium text-neutral-300 mb-1">
              Join Policy
            </label>
            <select
              id="room-policy"
              value={joinPolicy}
              onChange={(e) => setJoinPolicy(e.target.value as 'open' | 'inviteOnly' | 'moderated')}
              className="w-full bg-neutral-800 border border-neutral-700 rounded-md px-4 py-2 text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={submitting}
            >
              <option value="open">Open (anyone can join)</option>
              <option value="moderated">Moderated (requires approval)</option>
              <option value="inviteOnly">Invite Only</option>
            </select>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-md bg-neutral-700 text-neutral-100 hover:bg-neutral-600 transition-colors"
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim() || submitting}
              className="px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
