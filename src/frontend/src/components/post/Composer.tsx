import React, { useState } from 'react';
import { Button, Avatar } from '../common';
import { TextArea } from '../common/Input';
import { useAuthStore } from '../../stores/authStore';
import { useConfigStore } from '../../stores/configStore';
import { api } from '../../api/client';

interface ComposerProps {
  onPost?: () => void;
}

export function Composer({ onPost }: ComposerProps) {
  const [content, setContent] = useState('');
  const [contentWarning, setContentWarning] = useState('');
  const [showCW, setShowCW] = useState(false);
  const [isPosting, setIsPosting] = useState(false);
  const [error, setError] = useState('');

  const { user } = useAuthStore();
  const { config } = useConfigStore();

  const maxLength = config?.maxPostLength ?? 500;
  const remaining = maxLength - content.length;

  const handleSubmit = async () => {
    if (!content.trim()) return;
    if (content.length > maxLength) return;

    setIsPosting(true);
    setError('');

    try {
      await api.createPost({
        content: content.trim(),
        content_warning: showCW && contentWarning.trim() ? contentWarning.trim() : undefined,
      });
      setContent('');
      setContentWarning('');
      setShowCW(false);
      onPost?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to post');
    } finally {
      setIsPosting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      handleSubmit();
    }
  };

  if (!user) return null;

  return (
    <div className="p-4 border-b border-gray-200 bg-white">
      {error && (
        <div className="mb-3 p-3 bg-red-100 text-red-600 rounded-lg text-sm">
          {error}
        </div>
      )}

      <div className="flex gap-3">
        <Avatar src={user.avatar_url} alt={user.display_name} size="md" />
        <div className="flex-1">
          {showCW && (
            <input
              type="text"
              placeholder="Content warning (optional)"
              value={contentWarning}
              onChange={(e) => setContentWarning(e.target.value)}
              className="w-full px-3 py-2 mb-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          )}

          <TextArea
            placeholder="What's on your mind?"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            fullWidth
            rows={3}
          />

          <div className="flex items-center justify-between mt-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowCW(!showCW)}
                className={`px-2 py-1 text-sm rounded ${
                  showCW
                    ? 'bg-yellow-100 text-yellow-700'
                    : 'text-gray-500 hover:bg-gray-100'
                }`}
                title="Content warning"
              >
                CW
              </button>
            </div>

            <div className="flex items-center gap-3">
              <span
                className={`text-sm ${
                  remaining < 0
                    ? 'text-red-500 font-medium'
                    : remaining < 50
                    ? 'text-yellow-600'
                    : 'text-gray-500'
                }`}
              >
                {remaining}
              </span>
              <Button
                onClick={handleSubmit}
                disabled={!content.trim() || remaining < 0 || isPosting}
                loading={isPosting}
              >
                Post
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
