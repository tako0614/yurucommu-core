import { useState, useEffect, useCallback } from 'react';
import { Notification } from '../types';
import { acceptFollowRequest, fetchNotifications, markNotificationsRead, rejectFollowRequest } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { formatRelativeTime } from '../lib/datetime';
import { UserAvatar } from '../components/UserAvatar';
import { HeartIcon, ReplyIcon, RepostIcon } from '../components/icons/SocialIcons';
import { InlineErrorBanner } from '../components/InlineErrorBanner';
import { useInlineError } from '../hooks/useInlineError';

// SVG Icons
const FollowIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
  </svg>
);

const MentionIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207" />
  </svg>
);

const FollowRequestIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
  </svg>
);

type FilterType = 'all' | 'follow' | 'like' | 'announce' | 'mention' | 'reply';

export function NotificationPage() {
  const { t } = useI18n();
  const { error, setError, clearError } = useInlineError();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState<FilterType>('all');

  const loadNotifications = useCallback(async (typeFilter: FilterType) => {
    setLoading(true);
    try {
      const data = await fetchNotifications({ type: typeFilter === 'all' ? undefined : typeFilter });
      setNotifications(data);

      // Mark unread as read
      const unread = data.filter(n => !n.read);
      if (unread.length > 0) {
        await markNotificationsRead(unread.map(n => n.id));
        setNotifications(prev => prev.map(n => ({ ...n, read: true })));
      }
    } catch (e) {
      console.error('Failed to load notifications:', e);
      setError(t('common.error'));
    } finally {
      setLoading(false);
    }
  }, [setError, t]);

  useEffect(() => {
    loadNotifications(filter);
  }, [loadNotifications, filter]);

  const handleFollowRequest = async (notification: Notification, action: 'accept' | 'reject') => {
    if (pendingAction[notification.id]) return;
    setPendingAction(prev => ({ ...prev, [notification.id]: true }));
    try {
      if (action === 'accept') {
        await acceptFollowRequest(notification.actor.ap_id);
      } else {
        await rejectFollowRequest(notification.actor.ap_id);
      }
      setNotifications(prev => prev.filter(n => n.id !== notification.id));
    } catch (e) {
      console.error('Failed to handle follow request:', e);
      setError(t('common.error'));
    } finally {
      setPendingAction(prev => ({ ...prev, [notification.id]: false }));
    }
  };

  const getNotificationText = (notification: Notification) => {
    const actorName = notification.actor.name || notification.actor.preferred_username;
    switch (notification.type) {
      case 'follow':
        return <><span className="font-bold text-white">{actorName}</span>{t('notifications.follow')}</>;
      case 'follow_request':
        return <><span className="font-bold text-white">{actorName}</span> sent you a follow request</>;
      case 'like':
        return <><span className="font-bold text-white">{actorName}</span>{t('notifications.like')}</>;
      case 'announce':
        return <><span className="font-bold text-white">{actorName}</span>{t('notifications.repost')}</>;
      case 'mention':
        return <><span className="font-bold text-white">{actorName}</span>{t('notifications.mention')}</>;
      case 'reply':
        return <><span className="font-bold text-white">{actorName}</span>{t('notifications.reply')}</>;
      default:
        return 'New notification';
    }
  };

  const getNotificationIcon = (type: Notification['type']) => {
    switch (type) {
      case 'follow':
        return <div className="p-1 bg-blue-500 rounded-full text-white"><FollowIcon /></div>;
      case 'follow_request':
        return <div className="p-1 bg-yellow-500 rounded-full text-white"><FollowRequestIcon /></div>;
      case 'like':
        return (
          <div className="p-1 bg-pink-500 rounded-full text-white">
            <HeartIcon className="w-4 h-4" filled stroke={false} />
          </div>
        );
      case 'announce':
        return (
          <div className="p-1 bg-green-500 rounded-full text-white">
            <RepostIcon className="w-4 h-4" />
          </div>
        );
      case 'mention':
        return <div className="p-1 bg-purple-500 rounded-full text-white"><MentionIcon /></div>;
      case 'reply':
        return (
          <div className="p-1 bg-sky-500 rounded-full text-white">
            <ReplyIcon className="w-4 h-4" />
          </div>
        );
      default:
        return null;
    }
  };

  // Notifications are already filtered by the server
  const filteredNotifications = notifications;

  const filterTabs: { key: FilterType; label: string; icon: JSX.Element }[] = [
    { key: 'all', label: 'すべて', icon: <span className="w-4 h-4 flex items-center justify-center text-xs">全</span> },
    { key: 'follow', label: 'フォロー', icon: <FollowIcon /> },
    { key: 'like', label: 'いいね', icon: <HeartIcon className="w-4 h-4" filled stroke={false} /> },
    { key: 'announce', label: 'リポスト', icon: <RepostIcon className="w-4 h-4" /> },
    { key: 'mention', label: 'メンション', icon: <MentionIcon /> },
    { key: 'reply', label: '返信', icon: <ReplyIcon className="w-4 h-4" /> },
  ];

  return (
    <div className="flex flex-col h-full">
      {error && (
        <InlineErrorBanner message={error} onClose={clearError} />
      )}
      {/* Header */}
      <header className="sticky top-0 bg-black/80 backdrop-blur-sm border-b border-neutral-900 z-10">
        <h1 className="text-xl font-bold px-4 py-3">{t('notifications.title')}</h1>
        {/* Filter tabs */}
        <div className="flex overflow-x-auto scrollbar-hide border-t border-neutral-900">
          {filterTabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm whitespace-nowrap transition-colors border-b-2 ${
                filter === tab.key
                  ? 'text-white border-blue-500'
                  : 'text-neutral-500 border-transparent hover:text-neutral-300'
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      </header>

      {/* Notifications */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-8 text-center text-neutral-500">{t('common.loading')}</div>
        ) : filteredNotifications.length === 0 ? (
          <div className="p-8 text-center text-neutral-500">
            {filter === 'all' ? t('notifications.empty') : 'この種類の通知はありません'}
          </div>
        ) : (
          filteredNotifications.map(notification => (
            <div
              key={notification.id}
              className={`flex items-start gap-3 px-4 py-3 border-b border-neutral-900 hover:bg-neutral-900/30 transition-colors ${
                !notification.read ? 'bg-neutral-900/50' : ''
              }`}
            >
              <div className="relative shrink-0">
                <UserAvatar
                  avatarUrl={notification.actor.icon_url}
                  name={notification.actor.name || notification.actor.preferred_username}
                  size={40}
                />
                <span className="absolute -bottom-1 -right-1">
                  {getNotificationIcon(notification.type)}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[15px] text-neutral-400">{getNotificationText(notification)}</p>
                {notification.type === 'follow_request' && (
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => handleFollowRequest(notification, 'accept')}
                      disabled={pendingAction[notification.id]}
                      className="px-3 py-1 text-xs bg-blue-500 text-white rounded-full hover:bg-blue-600 transition-colors disabled:opacity-50"
                    >
                      Accept
                    </button>
                    <button
                      onClick={() => handleFollowRequest(notification, 'reject')}
                      disabled={pendingAction[notification.id]}
                      className="px-3 py-1 text-xs bg-neutral-800 text-neutral-200 rounded-full hover:bg-neutral-700 transition-colors disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </div>
                )}
                <p className="text-sm text-neutral-600 mt-1">
                  {formatRelativeTime(notification.created_at)}
                </p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default NotificationPage;
