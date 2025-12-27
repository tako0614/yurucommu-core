import React, { useEffect, useState } from 'react';
import { Avatar } from '../components/common';
import { api, type Notification } from '../api/client';

const typeLabels: Record<Notification['type'], string> = {
  follow: 'followed you',
  like: 'liked your post',
  announce: 'boosted your post',
  mention: 'mentioned you',
  reply: 'replied to your post',
};

const typeIcons: Record<Notification['type'], React.ReactNode> = {
  follow: (
    <svg className="w-5 h-5 text-blue-500" viewBox="0 0 24 24" fill="currentColor">
      <path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
      <circle cx="8.5" cy="7" r="4" />
      <line x1="20" y1="8" x2="20" y2="14" />
      <line x1="23" y1="11" x2="17" y2="11" />
    </svg>
  ),
  like: (
    <svg className="w-5 h-5 text-red-500" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
    </svg>
  ),
  announce: (
    <svg className="w-5 h-5 text-green-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M17 1l4 4-4 4" />
      <path d="M3 11V9a4 4 0 014-4h14" />
      <path d="M7 23l-4-4 4-4" />
      <path d="M21 13v2a4 4 0 01-4 4H3" />
    </svg>
  ),
  mention: (
    <svg className="w-5 h-5 text-purple-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="4" />
      <path d="M16 8v5a3 3 0 006 0v-1a10 10 0 10-3.92 7.94" />
    </svg>
  ),
  reply: (
    <svg className="w-5 h-5 text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" />
    </svg>
  ),
};

export function Notifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const data = await api.getNotifications();
        setNotifications(data);
        // Mark as read
        await api.markNotificationsRead();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (hours < 1) return 'just now';
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="max-w-2xl mx-auto">
      <header className="sticky top-0 bg-white/80 backdrop-blur-sm border-b border-gray-200 px-4 py-3 z-10">
        <h1 className="text-xl font-bold text-gray-900">Notifications</h1>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full" />
        </div>
      ) : error ? (
        <div className="p-4 text-center text-red-600">{error}</div>
      ) : notifications.length === 0 ? (
        <div className="p-8 text-center text-gray-500">
          <p className="text-lg">No notifications</p>
          <p className="text-sm mt-1">You're all caught up!</p>
        </div>
      ) : (
        <div>
          {notifications.map((notif) => (
            <div
              key={notif.id}
              className={`flex items-start gap-3 p-4 border-b border-gray-200 hover:bg-gray-50 transition-colors ${
                !notif.read_at ? 'bg-blue-50' : ''
              }`}
            >
              <div className="flex-shrink-0">{typeIcons[notif.type]}</div>
              <div className="flex-1 min-w-0">
                <p className="text-gray-900">
                  <span className="font-medium">{notif.actor_url.split('/').pop()}</span>{' '}
                  {typeLabels[notif.type]}
                </p>
                <p className="text-sm text-gray-500 mt-1">
                  {formatDate(notif.created_at)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
