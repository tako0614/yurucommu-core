import { useState, useEffect, useCallback } from 'react';
import { Notification } from '../types';
import { fetchNotifications, markNotificationsRead } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { UserAvatar } from '../components/UserAvatar';

// SVG Icons
const FollowIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
  </svg>
);

const HeartIcon = () => (
  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
    <path d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
  </svg>
);

const RepostIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
  </svg>
);

const MentionIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207" />
  </svg>
);

const ReplyIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
  </svg>
);

const JoinIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
  </svg>
);

const InviteIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
  </svg>
);

export function NotificationPage() {
  const { t } = useI18n();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  const loadNotifications = useCallback(async () => {
    try {
      const data = await fetchNotifications();
      setNotifications(data.notifications || []);

      // Mark unread as read
      const unread = data.notifications?.filter(n => !n.read) || [];
      if (unread.length > 0) {
        await markNotificationsRead(unread.map(n => n.id));
        setNotifications(prev => prev.map(n => ({ ...n, read: true })));
      }
    } catch (e) {
      console.error('Failed to load notifications:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  const getNotificationText = (notification: Notification) => {
    const actor = notification.actor_display_name || notification.actor_username;
    switch (notification.type) {
      case 'follow':
        return <><span className="font-bold text-white">{actor}</span>{t('notifications.follow')}</>;
      case 'like':
        return <><span className="font-bold text-white">{actor}</span>{t('notifications.like')}</>;
      case 'repost':
        return <><span className="font-bold text-white">{actor}</span>{t('notifications.repost')}</>;
      case 'mention':
        return <><span className="font-bold text-white">{actor}</span>{t('notifications.mention')}</>;
      case 'reply':
        return <><span className="font-bold text-white">{actor}</span>{t('notifications.reply')}</>;
      case 'join_request':
        return <><span className="font-bold text-white">{actor}</span>{t('notifications.joinRequest')}</>;
      case 'join_accepted':
        return <><span className="font-bold text-white">{actor}</span>{t('notifications.joinAccepted')}</>;
      case 'invite':
        return <><span className="font-bold text-white">{actor}</span>{t('notifications.invite')}</>;
      default:
        return 'New notification';
    }
  };

  const getNotificationIcon = (type: Notification['type']) => {
    switch (type) {
      case 'follow':
        return <div className="p-1 bg-blue-500 rounded-full text-white"><FollowIcon /></div>;
      case 'like':
        return <div className="p-1 bg-pink-500 rounded-full text-white"><HeartIcon /></div>;
      case 'repost':
        return <div className="p-1 bg-green-500 rounded-full text-white"><RepostIcon /></div>;
      case 'mention':
        return <div className="p-1 bg-purple-500 rounded-full text-white"><MentionIcon /></div>;
      case 'reply':
        return <div className="p-1 bg-sky-500 rounded-full text-white"><ReplyIcon /></div>;
      case 'join_request':
      case 'join_accepted':
        return <div className="p-1 bg-indigo-500 rounded-full text-white"><JoinIcon /></div>;
      case 'invite':
        return <div className="p-1 bg-yellow-500 rounded-full text-white"><InviteIcon /></div>;
      default:
        return null;
    }
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'now';
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 7) return `${diffDays}d`;
    return date.toLocaleDateString();
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="sticky top-0 bg-black/80 backdrop-blur-sm border-b border-neutral-900 z-10">
        <h1 className="text-xl font-bold px-4 py-3">{t('notifications.title')}</h1>
      </header>

      {/* Notifications */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-8 text-center text-neutral-500">{t('common.loading')}</div>
        ) : notifications.length === 0 ? (
          <div className="p-8 text-center text-neutral-500">{t('notifications.empty')}</div>
        ) : (
          notifications.map(notification => (
            <div
              key={notification.id}
              className={`flex items-start gap-3 px-4 py-3 border-b border-neutral-900 hover:bg-neutral-900/30 transition-colors ${
                !notification.read ? 'bg-neutral-900/50' : ''
              }`}
            >
              <div className="relative shrink-0">
                <UserAvatar
                  avatarUrl={notification.actor_avatar_url}
                  name={notification.actor_display_name || notification.actor_username}
                  size={40}
                />
                <span className="absolute -bottom-1 -right-1">
                  {getNotificationIcon(notification.type)}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[15px] text-neutral-400">{getNotificationText(notification)}</p>
                <p className="text-sm text-neutral-600 mt-1">
                  {formatTime(notification.created_at)}
                </p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
