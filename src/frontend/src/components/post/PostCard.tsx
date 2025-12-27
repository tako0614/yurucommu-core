import React from 'react';
import { Avatar } from '../common';
import type { Post } from '../../api/client';

interface PostCardProps {
  post: Post;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
  onDelete?: (id: string) => void;
  isOwn?: boolean;
}

export function PostCard({
  post,
  username,
  displayName,
  avatarUrl,
  onDelete,
  isOwn = false,
}: PostCardProps) {
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m`;
    if (hours < 24) return `${hours}h`;
    if (days < 7) return `${days}d`;

    return date.toLocaleDateString();
  };

  return (
    <article className="p-4 border-b border-gray-200 hover:bg-gray-50 transition-colors">
      <div className="flex gap-3">
        <Avatar src={avatarUrl} alt={displayName} size="md" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-semibold text-gray-900 truncate">
              {displayName}
            </span>
            <span className="text-gray-500 text-sm truncate">
              @{username}
            </span>
            <span className="text-gray-400 text-sm">
              · {formatDate(post.published_at)}
            </span>
            {isOwn && onDelete && (
              <button
                onClick={() => onDelete(post.id)}
                className="ml-auto text-gray-400 hover:text-red-500 transition-colors"
                title="Delete post"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 6h18" />
                  <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                </svg>
              </button>
            )}
          </div>

          {post.content_warning && (
            <div className="mb-2 px-2 py-1 bg-yellow-50 text-yellow-800 text-sm rounded">
              CW: {post.content_warning}
            </div>
          )}

          <div className="text-gray-900 whitespace-pre-wrap break-words">
            {post.content}
          </div>

          {post.attachments && post.attachments.length > 0 && (
            <div className="mt-3 space-y-2">
              {post.attachments.map((attachment, index) => (
                <div key={index}>
                  {attachment.type === 'image' ? (
                    <img
                      src={attachment.url}
                      alt={attachment.description || 'Attachment'}
                      className="max-w-full rounded-lg"
                    />
                  ) : (
                    <a
                      href={attachment.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline"
                    >
                      {attachment.url}
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-4 mt-3 text-gray-500">
            <button className="flex items-center gap-1 hover:text-blue-500 transition-colors">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" />
              </svg>
              <span className="text-sm">Reply</span>
            </button>
            <button className="flex items-center gap-1 hover:text-green-500 transition-colors">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 1l4 4-4 4" />
                <path d="M3 11V9a4 4 0 014-4h14" />
                <path d="M7 23l-4-4 4-4" />
                <path d="M21 13v2a4 4 0 01-4 4H3" />
              </svg>
              <span className="text-sm">Boost</span>
            </button>
            <button className="flex items-center gap-1 hover:text-red-500 transition-colors">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
              </svg>
              <span className="text-sm">Like</span>
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}
