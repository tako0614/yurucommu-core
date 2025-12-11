import { useState, useEffect, useCallback } from "react";
import { defineScreen, useCore, useTakos, Link } from "@takos/app-sdk";

export const NotificationsScreen = defineScreen({
  id: "screen.notifications",
  path: "/notifications",
  title: "Notifications",
  auth: "required",
  component: Notifications
});

interface Notification {
  id: string;
  type: "follow" | "like" | "reply" | "mention" | "repost";
  read: boolean;
  actor: {
    id: string;
    handle: string;
    displayName: string;
    avatar?: string;
  };
  post?: {
    id: string;
    content: string;
  };
  createdAt: string;
}

function Notifications() {
  const core = useCore();
  const { ui } = useTakos();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  const loadNotifications = useCallback(async () => {
    try {
      const data = await core.notifications.list({ limit: 50 });
      setNotifications(data as Notification[]);
    } catch (error) {
      console.error("Failed to load notifications:", error);
      ui.toast("Failed to load notifications", "error");
    } finally {
      setLoading(false);
    }
  }, [core, ui]);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  const markAllRead = async () => {
    const unreadIds = notifications.filter(n => !n.read).map(n => n.id);
    if (unreadIds.length === 0) return;

    try {
      await core.notifications.markRead(unreadIds);
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
      ui.toast("All notifications marked as read", "success");
    } catch (error) {
      console.error("Failed to mark notifications as read:", error);
      ui.toast("Failed to mark as read", "error");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <div className="max-w-2xl mx-auto">
      <header className="sticky top-0 bg-white/80 dark:bg-black/80 backdrop-blur-sm border-b border-gray-200 dark:border-gray-800 px-4 py-3 flex items-center justify-between z-10">
        <h1 className="text-xl font-bold">Notifications</h1>
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={markAllRead}
            className="text-sm text-blue-600 hover:underline"
          >
            Mark all as read
          </button>
        )}
      </header>

      <div className="divide-y divide-gray-200 dark:divide-gray-800">
        {notifications.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            No notifications yet
          </div>
        ) : (
          notifications.map(notification => (
            <NotificationItem key={notification.id} notification={notification} />
          ))
        )}
      </div>
    </div>
  );
}

function NotificationItem({ notification }: { notification: Notification }) {
  const { type, actor, post, read, createdAt } = notification;
  const timeAgo = formatTimeAgo(createdAt);

  const getMessage = () => {
    switch (type) {
      case "follow":
        return "followed you";
      case "like":
        return "liked your post";
      case "reply":
        return "replied to your post";
      case "mention":
        return "mentioned you";
      case "repost":
        return "reposted your post";
      default:
        return "interacted with you";
    }
  };

  const getIcon = () => {
    switch (type) {
      case "follow":
        return <FollowIcon />;
      case "like":
        return <HeartIcon />;
      case "reply":
        return <ReplyIcon />;
      case "mention":
        return <MentionIcon />;
      case "repost":
        return <RepostIcon />;
      default:
        return <BellIcon />;
    }
  };

  const getIconColor = () => {
    switch (type) {
      case "follow":
        return "text-blue-500";
      case "like":
        return "text-pink-500";
      case "reply":
        return "text-green-500";
      case "mention":
        return "text-purple-500";
      case "repost":
        return "text-green-500";
      default:
        return "text-gray-500";
    }
  };

  const linkTo = type === "follow" ? `/@${actor.handle}` : post ? `/posts/${post.id}` : `/@${actor.handle}`;

  return (
    <Link
      to={linkTo}
      className={`block px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-900/50 transition-colors ${
        !read ? "bg-blue-50/50 dark:bg-blue-900/10" : ""
      }`}
    >
      <div className="flex gap-3">
        <div className={`flex-shrink-0 mt-1 ${getIconColor()}`}>
          {getIcon()}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {actor.avatar ? (
              <img
                src={actor.avatar}
                alt={actor.displayName}
                className="w-8 h-8 rounded-full object-cover"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                <span className="text-gray-500 dark:text-gray-400 text-xs font-medium">
                  {actor.displayName.charAt(0).toUpperCase()}
                </span>
              </div>
            )}
            <span className="font-semibold truncate">{actor.displayName}</span>
            <span className="text-gray-500 dark:text-gray-400">{getMessage()}</span>
            <span className="text-gray-400 dark:text-gray-500 text-sm">{timeAgo}</span>
          </div>

          {post && (
            <p className="mt-1 text-gray-500 dark:text-gray-400 line-clamp-2">
              {post.content}
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}

function FollowIcon() {
  return (
    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
      <path d="M19 14v3h3v2h-3v3h-2v-3h-3v-2h3v-3h2zm-8 1H3v-1c0-2.66 5.33-4 8-4s3 0 3 0v1c0 1-1 3-3 4zm4-11a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  );
}

function HeartIcon() {
  return (
    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
    </svg>
  );
}

function ReplyIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
    </svg>
  );
}

function MentionIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207" />
    </svg>
  );
}

function RepostIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
    </svg>
  );
}

function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 7) {
    return date.toLocaleDateString();
  }
  if (days > 0) {
    return `${days}d`;
  }
  if (hours > 0) {
    return `${hours}h`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return "now";
}
