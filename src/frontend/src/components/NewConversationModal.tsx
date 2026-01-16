import { useState, useCallback } from 'react';
import { searchActors } from '../lib/api';
import { UserAvatar } from './UserAvatar';
import { Actor } from '../types';

interface NewConversationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (actor: Actor) => void;
}

export function NewConversationModal({ isOpen, onClose, onSelect }: NewConversationModalProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Actor[]>([]);
  const [loading, setLoading] = useState(false);

  const handleSearch = useCallback(async (q: string) => {
    setQuery(q);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const actors = await searchActors(q);
      setResults(actors);
    } catch (e) {
      console.error('Search failed:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSelect = (actor: Actor) => {
    onSelect(actor);
    setQuery('');
    setResults([]);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-md bg-neutral-900 rounded-2xl overflow-hidden shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
          <h2 className="text-lg font-semibold">新しいメッセージ</h2>
          <button
            onClick={onClose}
            className="p-1 text-neutral-400 hover:text-white transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Search input */}
        <div className="p-4 border-b border-neutral-800">
          <div className="flex items-center gap-3">
            <span className="text-neutral-400">宛先:</span>
            <input
              type="text"
              value={query}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="ユーザーを検索..."
              className="flex-1 bg-transparent text-white placeholder-neutral-500 outline-none"
              autoFocus
            />
          </div>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto">
          {loading ? (
            <div className="p-8 text-center text-neutral-500">検索中...</div>
          ) : results.length > 0 ? (
            <div className="py-2">
              {results.map((actor) => (
                <button
                  key={actor.ap_id}
                  onClick={() => handleSelect(actor)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-neutral-800 transition-colors"
                >
                  <UserAvatar
                    avatarUrl={actor.icon_url}
                    name={actor.name || actor.preferred_username}
                    size={44}
                  />
                  <div className="flex-1 text-left">
                    <p className="font-medium">{actor.name || actor.preferred_username}</p>
                    <p className="text-sm text-neutral-500">@{actor.preferred_username}</p>
                  </div>
                </button>
              ))}
            </div>
          ) : query.length >= 2 ? (
            <div className="p-8 text-center text-neutral-500">
              ユーザーが見つかりません
            </div>
          ) : (
            <div className="p-8 text-center text-neutral-500">
              ユーザー名を入力して検索
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
