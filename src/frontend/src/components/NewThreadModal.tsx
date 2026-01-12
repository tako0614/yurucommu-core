import { useState, FormEvent } from 'react';

interface NewThreadModalProps {
  onClose: () => void;
  onCreate: (title: string, content: string) => Promise<void>;
}

export function NewThreadModal({ onClose, onCreate }: NewThreadModalProps) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || submitting) return;

    setSubmitting(true);
    try {
      await onCreate(title.trim(), content.trim());
      onClose();
    } catch (e) {
      console.error('Failed to create thread:', e);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-neutral-900 border border-neutral-700 rounded-lg w-full max-w-lg mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-neutral-700 flex items-center justify-between">
          <h3 className="text-lg font-semibold">New Thread</h3>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-100">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label htmlFor="title" className="block text-sm font-medium text-neutral-300 mb-1">
              Title *
            </label>
            <input
              id="title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-neutral-800 border border-neutral-700 rounded-md px-4 py-2 text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Thread title"
              disabled={submitting}
              autoFocus
            />
          </div>

          <div>
            <label htmlFor="content" className="block text-sm font-medium text-neutral-300 mb-1">
              Content (optional)
            </label>
            <textarea
              id="content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full h-32 bg-neutral-800 border border-neutral-700 rounded-md px-4 py-2 text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              placeholder="Describe your topic..."
              disabled={submitting}
            />
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
              disabled={!title.trim() || submitting}
              className="px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? 'Creating...' : 'Create Thread'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
