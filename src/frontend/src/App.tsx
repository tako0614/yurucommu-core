import React, { useState, useEffect, useCallback } from 'react';

interface User {
  id: string;
  username: string;
  display_name: string;
  summary: string;
  avatar_url: string | null;
  header_url: string | null;
}

interface Post {
  id: string;
  content: string;
  content_warning: string | null;
  visibility: string;
  published_at: string;
  attachments?: Attachment[];
  author?: {
    username: string;
    display_name: string;
    avatar_url: string | null;
    actor_url?: string;
  };
}

interface Attachment {
  url: string;
  mediaType: string | null;
  name: string | null;
}

interface FeatureFlags {
  enableBoosts: boolean;
  enableLikes: boolean;
  enableReplies: boolean;
}

interface Notification {
  id: string;
  type: string;
  actor_url: string;
  actor: {
    preferredUsername?: string;
    name?: string;
    icon?: { url?: string };
  } | null;
  object_url: string | null;
  read: boolean;
  created_at: string;
}

interface FollowItem {
  id: string;
  actor_url: string;
  status: string;
  actor: {
    preferredUsername?: string;
    name?: string;
    icon?: { url?: string };
  } | null;
}

type View = 'loading' | 'setup' | 'home' | 'notifications' | 'following' | 'followers' | 'profile';

function App() {
  const [view, setView] = useState<View>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [following, setFollowing] = useState<FollowItem[]>([]);
  const [followers, setFollowers] = useState<FollowItem[]>([]);
  const [pendingFollowers, setPendingFollowers] = useState<FollowItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [maxPostLength, setMaxPostLength] = useState(500);
  const [siteName, setSiteName] = useState('Takos');
  const [siteDescription, setSiteDescription] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [footerHtml, setFooterHtml] = useState<string | null>(null);
  const [features, setFeatures] = useState<FeatureFlags>({
    enableBoosts: true,
    enableLikes: true,
    enableReplies: true,
  });

  const normalizeHexColor = (value: string): string | null => {
    const trimmed = value.trim();
    if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(trimmed)) {
      return null;
    }
    if (trimmed.length === 4) {
      return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`;
    }
    return trimmed.toLowerCase();
  };

  const lightenHex = (hex: string, amount: number): string => {
    const normalized = normalizeHexColor(hex) || hex;
    const r = parseInt(normalized.slice(1, 3), 16);
    const g = parseInt(normalized.slice(3, 5), 16);
    const b = parseInt(normalized.slice(5, 7), 16);
    const mix = (channel: number) =>
      Math.min(255, Math.round(channel + (255 - channel) * amount));
    const toHex = (value: number) => value.toString(16).padStart(2, '0');
    return `#${toHex(mix(r))}${toHex(mix(g))}${toHex(mix(b))}`;
  };

  const applyAccentColor = (color: string | null) => {
    if (!color) return;
    const normalized = normalizeHexColor(color);
    if (!normalized) return;
    const root = document.documentElement;
    root.style.setProperty('--accent', normalized);
    root.style.setProperty('--accent-hover', lightenHex(normalized, 0.18));
  };

  const applyTheme = (css: string | null) => {
    const styleId = 'l1-theme';
    let styleEl = document.getElementById(styleId) as HTMLStyleElement | null;
    if (!css || css.trim().length === 0) {
      if (styleEl) {
        styleEl.remove();
      }
      return;
    }
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = styleId;
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = css;
  };

  const applyFavicon = (url: string | null) => {
    const link = document.querySelector("link[rel='icon']") as HTMLLinkElement | null;
    if (!url || url.trim().length === 0) {
      if (link) link.remove();
      return;
    }
    if (link) {
      link.href = url;
      return;
    }
    const newLink = document.createElement('link');
    newLink.rel = 'icon';
    newLink.href = url;
    document.head.appendChild(newLink);
  };

  const applyMetaDescription = (description: string | null) => {
    const meta = document.querySelector("meta[name='description']") as HTMLMetaElement | null;
    const value = description ? description.trim() : '';
    if (!value) {
      if (meta) meta.removeAttribute('content');
      return;
    }
    if (meta) {
      meta.content = value;
      return;
    }
    const newMeta = document.createElement('meta');
    newMeta.name = 'description';
    newMeta.content = value;
    document.head.appendChild(newMeta);
  };

  const fetchConfig = async () => {
    try {
      const res = await fetch('/api/config');
      if (res.ok) {
        const data = await res.json();
        if (typeof data?.config?.content?.maxPostLength === 'number') {
          setMaxPostLength(data.config.content.maxPostLength);
        }
        if (typeof data?.config?.siteName === 'string' && data.config.siteName.trim().length > 0) {
          const name = data.config.siteName.trim();
          setSiteName(name);
          document.title = name;
        }
        if (typeof data?.config?.siteDescription === 'string') {
          const description = data.config.siteDescription.trim();
          setSiteDescription(description.length > 0 ? description : null);
          applyMetaDescription(description.length > 0 ? description : null);
        } else {
          setSiteDescription(null);
          applyMetaDescription(null);
        }
        if (typeof data?.config?.language === 'string' && data.config.language.trim().length > 0) {
          document.documentElement.lang = data.config.language.trim();
        }
        if (typeof data?.config?.ui?.logoUrl === 'string') {
          setLogoUrl(data.config.ui.logoUrl);
        } else {
          setLogoUrl(null);
        }
        if (typeof data?.config?.ui?.customFooterHtml === 'string') {
          const footer = data.config.ui.customFooterHtml.trim();
          setFooterHtml(footer.length > 0 ? footer : null);
        } else {
          setFooterHtml(null);
        }
        if (typeof data?.config?.features === 'object' && data.config.features) {
          setFeatures({
            enableBoosts: data.config.features.enableBoosts !== false,
            enableLikes: data.config.features.enableLikes !== false,
            enableReplies: data.config.features.enableReplies !== false,
          });
        }
        applyAccentColor(typeof data?.config?.ui?.accentColor === 'string' ? data.config.ui.accentColor : null);
        applyFavicon(typeof data?.config?.ui?.faviconUrl === 'string' ? data.config.ui.faviconUrl : null);
        applyTheme(typeof data?.theme === 'string' ? data.theme : null);
      }
    } catch {
      // Ignore
    }
  };

  const fetchUser = useCallback(async () => {
    try {
      const res = await fetch('/api/me');
      if (res.ok) {
        const data = await res.json();
        setUser(data);
        setView('home');
        fetchConfig();
        fetchPosts();
        fetchNotifications();
      } else if (res.status === 401) {
        setView('setup');
      }
    } catch {
      setView('setup');
    }
  }, []);

  const fetchPosts = async () => {
    try {
      const res = await fetch('/api/timeline/home');
      if (res.ok) {
        const data = await res.json();
        setPosts(data);
      }
    } catch {
      // Ignore
    }
  };

  const fetchNotifications = async () => {
    try {
      const res = await fetch('/api/notifications');
      if (res.ok) {
        const data = await res.json();
        setNotifications(data);
        setUnreadCount(data.filter((n: Notification) => !n.read).length);
      }
    } catch {
      // Ignore
    }
  };

  const fetchFollowing = async () => {
    try {
      const res = await fetch('/api/following');
      if (res.ok) {
        const data = await res.json();
        setFollowing(data);
      }
    } catch {
      // Ignore
    }
  };

  const fetchFollowers = async () => {
    try {
      const res = await fetch('/api/followers');
      if (res.ok) {
        const data = await res.json();
        setFollowers(data);
      }
    } catch {
      // Ignore
    }
  };

  const fetchPendingFollowers = async () => {
    try {
      const res = await fetch('/api/follows/pending');
      if (res.ok) {
        const data = await res.json();
        setPendingFollowers(data);
      }
    } catch {
      // Ignore
    }
  };

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  useEffect(() => {
    if (view === 'following') fetchFollowing();
    if (view === 'followers') {
      fetchFollowers();
      fetchPendingFollowers();
    }
    if (view === 'notifications') fetchNotifications();
  }, [view]);

  if (view === 'loading') {
    return <Loading />;
  }

  if (view === 'setup') {
    return <Setup onComplete={fetchUser} />;
  }

  return (
    <div className="app">
        <Sidebar
          user={user}
          currentView={view}
          unreadCount={unreadCount}
          onNavigate={setView}
          siteName={siteName}
          logoUrl={logoUrl}
          siteDescription={siteDescription}
        />
      <main className="main-content">
        {view === 'home' && (
          <HomeView
            user={user}
            posts={posts}
            onRefresh={fetchPosts}
            maxPostLength={maxPostLength}
            features={features}
          />
        )}
        {view === 'notifications' && (
          <NotificationsView
            notifications={notifications}
            onRefresh={fetchNotifications}
          />
        )}
        {view === 'following' && (
          <FollowingView
            following={following}
            onRefresh={fetchFollowing}
          />
        )}
        {view === 'followers' && (
          <FollowersView
            followers={followers}
            pending={pendingFollowers}
            onAccept={async (id) => {
              await fetch(`/api/follows/${id}/accept`, { method: 'POST' });
              fetchFollowers();
              fetchPendingFollowers();
            }}
            onReject={async (id) => {
              await fetch(`/api/follows/${id}/reject`, { method: 'POST' });
              fetchFollowers();
              fetchPendingFollowers();
            }}
          />
        )}
        {view === 'profile' && user && (
          <ProfileView
            user={user}
            onUpdate={fetchUser}
          />
        )}
        {footerHtml && (
          <div className="app-footer" dangerouslySetInnerHTML={{ __html: footerHtml }} />
        )}
      </main>
    </div>
  );
}

function Loading() {
  return (
    <div className="loading-screen">
      <div className="loading-spinner" />
      <p>Loading...</p>
    </div>
  );
}

function Setup({ onComplete }: { onComplete: () => void }) {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [summary, setSummary] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, display_name: displayName, summary }),
      });

      if (res.ok) {
        onComplete();
      } else {
        const data = await res.json();
        setError(data.error || 'Setup failed');
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="setup-container">
      <div className="setup-card">
        <div className="setup-header">
          <h1>Takos</h1>
          <p>Set up your profile to get started</p>
        </div>
        {error && <div className="error-message">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="input-group">
            <label>Username</label>
            <input
              type="text"
              className="input"
              placeholder="alice"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              pattern="[a-zA-Z0-9_]+"
              required
            />
            <span className="input-hint">Letters, numbers, and underscores only</span>
          </div>
          <div className="input-group">
            <label>Display Name</label>
            <input
              type="text"
              className="input"
              placeholder="Alice"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
            />
          </div>
          <div className="input-group">
            <label>Bio</label>
            <textarea
              className="textarea"
              placeholder="Tell us about yourself..."
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={3}
            />
          </div>
          <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
            {loading ? 'Creating...' : 'Create Profile'}
          </button>
        </form>
      </div>
    </div>
  );
}

function Sidebar({
  user,
  currentView,
  unreadCount,
  onNavigate,
  siteName,
  logoUrl,
  siteDescription,
}: {
  user: User | null;
  currentView: View;
  unreadCount: number;
  onNavigate: (view: View) => void;
  siteName: string;
  logoUrl: string | null;
  siteDescription: string | null;
}) {
  const handleLogout = async () => {
    await fetch('/api/logout', { method: 'POST' });
    window.location.reload();
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        {logoUrl ? <img className="sidebar-logo" src={logoUrl} alt="" /> : null}
        <div className="sidebar-title">
          <h1>{siteName}</h1>
          {siteDescription ? (
            <p className="sidebar-description">{siteDescription}</p>
          ) : null}
        </div>
      </div>
      <nav className="sidebar-nav">
        <NavItem
          icon="home"
          label="Home"
          active={currentView === 'home'}
          onClick={() => onNavigate('home')}
        />
        <NavItem
          icon="bell"
          label="Notifications"
          badge={unreadCount > 0 ? unreadCount : undefined}
          active={currentView === 'notifications'}
          onClick={() => onNavigate('notifications')}
        />
        <NavItem
          icon="users"
          label="Following"
          active={currentView === 'following'}
          onClick={() => onNavigate('following')}
        />
        <NavItem
          icon="followers"
          label="Followers"
          active={currentView === 'followers'}
          onClick={() => onNavigate('followers')}
        />
        <NavItem
          icon="user"
          label="Profile"
          active={currentView === 'profile'}
          onClick={() => onNavigate('profile')}
        />
      </nav>
      {user && (
        <div className="sidebar-user">
          <div className="user-avatar">
            {user.avatar_url ? (
              <img src={user.avatar_url} alt="" />
            ) : (
              <span>{user.display_name[0]}</span>
            )}
          </div>
          <div className="user-info">
            <div className="user-name">{user.display_name}</div>
            <div className="user-handle">@{user.username}</div>
          </div>
          <button className="btn-icon" onClick={handleLogout} title="Logout">
            <span className="icon-logout" />
          </button>
        </div>
      )}
    </aside>
  );
}

function NavItem({
  icon,
  label,
  badge,
  active,
  onClick,
}: {
  icon: string;
  label: string;
  badge?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}>
      <span className={`icon icon-${icon}`} />
      <span className="nav-label">{label}</span>
      {badge !== undefined && <span className="nav-badge">{badge}</span>}
    </button>
  );
}

function HomeView({
  user,
  posts,
  onRefresh,
  maxPostLength,
  features,
}: {
  user: User | null;
  posts: Post[];
  onRefresh: () => void;
  maxPostLength: number;
  features: FeatureFlags;
}) {
  return (
    <div className="view home-view">
      <header className="view-header">
        <h2>Home</h2>
      </header>
      <Composer onPost={onRefresh} maxPostLength={maxPostLength} />
      <div className="timeline">
        {posts.length === 0 ? (
          <div className="empty-state">
            <p>No posts yet</p>
            <span>Write your first post or follow someone to see their posts!</span>
          </div>
        ) : (
          posts.map((post) => (
            <PostCard key={post.id} post={post} user={user} features={features} />
          ))
        )}
      </div>
    </div>
  );
}

function Composer({ onPost, maxPostLength }: { onPost: () => void; maxPostLength: number }) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = content.trim();
    if (!trimmed) return;
    if (trimmed.length > maxPostLength) return;

    setLoading(true);
    try {
      const res = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });

      if (res.ok) {
        setContent('');
        onPost();
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="composer">
      <form onSubmit={handleSubmit}>
        <textarea
          className="composer-input"
          placeholder="What's on your mind?"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={3}
        />
        <div className="composer-footer">
          <span className="char-count">{content.length} / {maxPostLength}</span>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading || !content.trim() || content.length > maxPostLength}
          >
            {loading ? 'Posting...' : 'Post'}
          </button>
        </div>
      </form>
    </div>
  );
}

function PostCard({
  post,
  user,
  features,
}: {
  post: Post;
  user: User | null;
  features: FeatureFlags;
}) {
  const author = post.author || {
    display_name: user?.display_name || 'Unknown',
    username: user?.username || 'unknown',
    avatar_url: user?.avatar_url || null,
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'now';
    if (minutes < 60) return `${minutes}m`;
    if (hours < 24) return `${hours}h`;
    if (days < 7) return `${days}d`;
    return date.toLocaleDateString();
  };

  return (
    <article className="post-card">
      <div className="post-avatar">
        {author.avatar_url ? (
          <img src={author.avatar_url} alt="" />
        ) : (
          <span>{author.display_name[0]}</span>
        )}
      </div>
      <div className="post-content">
        <header className="post-header">
          <span className="post-author">{author.display_name}</span>
          <span className="post-handle">@{author.username}</span>
          <span className="post-time">{formatTime(post.published_at)}</span>
        </header>
        {post.content_warning && (
          <div className="content-warning">
            CW: {post.content_warning}
          </div>
        )}
        <div className="post-body">{post.content}</div>
        {post.attachments && post.attachments.length > 0 && (
          <div className="post-attachments">
            {post.attachments.map((attachment, index) => {
              const isImage = attachment.mediaType?.startsWith('image/');
              if (isImage) {
                return (
                  <img
                    key={`${post.id}-attachment-${index}`}
                    src={attachment.url}
                    alt={attachment.name || ''}
                    loading="lazy"
                  />
                );
              }
              const label = attachment.name || attachment.url;
              return (
                <a
                  key={`${post.id}-attachment-${index}`}
                  className="attachment-link"
                  href={attachment.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {label}
                </a>
              );
            })}
          </div>
        )}
        <footer className="post-actions">
          <button className="action-btn" title="Reply" disabled={!features.enableReplies}>
            <span className="icon icon-reply" />
          </button>
          <button className="action-btn" title="Boost" disabled={!features.enableBoosts}>
            <span className="icon icon-boost" />
          </button>
          <button className="action-btn" title="Like" disabled={!features.enableLikes}>
            <span className="icon icon-like" />
          </button>
        </footer>
      </div>
    </article>
  );
}

function NotificationsView({
  notifications,
  onRefresh,
}: {
  notifications: Notification[];
  onRefresh: () => void;
}) {
  const markAllRead = async () => {
    await fetch('/api/notifications/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true }),
    });
    onRefresh();
  };

  const getNotificationText = (notification: Notification) => {
    const actor = notification.actor;
    const name = actor?.name || actor?.preferredUsername || 'Someone';

    switch (notification.type) {
      case 'follow':
        return `${name} followed you`;
      case 'like':
        return `${name} liked your post`;
      case 'boost':
        return `${name} boosted your post`;
      case 'mention':
        return `${name} mentioned you`;
      case 'reply':
        return `${name} replied to your post`;
      default:
        return `${name} interacted with you`;
    }
  };

  return (
    <div className="view notifications-view">
      <header className="view-header">
        <h2>Notifications</h2>
        {notifications.some(n => !n.read) && (
          <button className="btn btn-secondary" onClick={markAllRead}>
            Mark all read
          </button>
        )}
      </header>
      <div className="notifications-list">
        {notifications.length === 0 ? (
          <div className="empty-state">
            <p>No notifications yet</p>
          </div>
        ) : (
          notifications.map((notification) => (
            <div
              key={notification.id}
              className={`notification-item ${!notification.read ? 'unread' : ''}`}
            >
              <div className="notification-avatar">
                {notification.actor?.icon?.url ? (
                  <img src={notification.actor.icon.url} alt="" />
                ) : (
                  <span>{(notification.actor?.name || '?')[0]}</span>
                )}
              </div>
              <div className="notification-content">
                <p>{getNotificationText(notification)}</p>
                <span className="notification-time">
                  {new Date(notification.created_at).toLocaleString()}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function FollowingView({
  following,
  onRefresh,
}: {
  following: FollowItem[];
  onRefresh: () => void;
}) {
  const [account, setAccount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFollow = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!account.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/follow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account }),
      });

      if (res.ok) {
        setAccount('');
        onRefresh();
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to follow');
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  const handleUnfollow = async (actorUrl: string) => {
    try {
      await fetch('/api/unfollow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actor_url: actorUrl }),
      });
      onRefresh();
    } catch {
      // Ignore
    }
  };

  return (
    <div className="view following-view">
      <header className="view-header">
        <h2>Following</h2>
      </header>

      <div className="follow-form card">
        <h3>Follow a new account</h3>
        <form onSubmit={handleFollow}>
          <div className="follow-input-group">
            <input
              type="text"
              className="input"
              placeholder="@user@instance.social"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
            />
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Following...' : 'Follow'}
            </button>
          </div>
          {error && <div className="error-text">{error}</div>}
        </form>
      </div>

      <div className="follow-list">
        {following.length === 0 ? (
          <div className="empty-state">
            <p>Not following anyone yet</p>
            <span>Enter an account address above to follow someone!</span>
          </div>
        ) : (
          following.map((item) => (
            <div key={item.actor_url} className="follow-item">
              <div className="follow-avatar">
                {item.actor?.icon?.url ? (
                  <img src={item.actor.icon.url} alt="" />
                ) : (
                  <span>{(item.actor?.name || '?')[0]}</span>
                )}
              </div>
              <div className="follow-info">
                <div className="follow-name">{item.actor?.name || 'Unknown'}</div>
                <div className="follow-handle">
                  @{item.actor?.preferredUsername || new URL(item.actor_url).pathname.split('/').pop()}
                </div>
                {item.status === 'pending' && (
                  <span className="follow-status pending">Pending</span>
                )}
              </div>
              <button
                className="btn btn-secondary"
                onClick={() => handleUnfollow(item.actor_url)}
              >
                Unfollow
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function FollowersView({
  followers,
  pending,
  onAccept,
  onReject,
}: {
  followers: FollowItem[];
  pending: FollowItem[];
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
}) {
  return (
    <div className="view followers-view">
      <header className="view-header">
        <h2>Followers</h2>
        <span className="count">{followers.length}</span>
      </header>
      {pending.length > 0 && (
        <div className="follow-requests">
          <h3>Requests</h3>
          <div className="follow-list">
            {pending.map((item) => (
              <div key={item.id} className="follow-item">
                <div className="follow-avatar">
                  {item.actor?.icon?.url ? (
                    <img src={item.actor.icon.url} alt="" />
                  ) : (
                    <span>{(item.actor?.name || '?')[0]}</span>
                  )}
                </div>
                <div className="follow-info">
                  <div className="follow-name">{item.actor?.name || 'Unknown'}</div>
                  <div className="follow-handle">
                    @{item.actor?.preferredUsername || new URL(item.actor_url).pathname.split('/').pop()}
                  </div>
                </div>
                <div className="follow-actions">
                  <button className="btn btn-primary" onClick={() => onAccept(item.id)}>
                    Accept
                  </button>
                  <button className="btn btn-secondary" onClick={() => onReject(item.id)}>
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="follow-list">
        {followers.length === 0 ? (
          <div className="empty-state">
            <p>No followers yet</p>
            <span>Share your profile to get followers!</span>
          </div>
        ) : (
          followers.map((item) => (
            <div key={item.id} className="follow-item">
              <div className="follow-avatar">
                {item.actor?.icon?.url ? (
                  <img src={item.actor.icon.url} alt="" />
                ) : (
                  <span>{(item.actor?.name || '?')[0]}</span>
                )}
              </div>
              <div className="follow-info">
                <div className="follow-name">{item.actor?.name || 'Unknown'}</div>
                <div className="follow-handle">
                  @{item.actor?.preferredUsername || new URL(item.actor_url).pathname.split('/').pop()}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ProfileView({
  user,
  onUpdate,
}: {
  user: User;
  onUpdate: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(user.display_name);
  const [summary, setSummary] = useState(user.summary);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hostname = window.location.host;
  const actorUrl = `https://${hostname}/users/${user.username}`;

  const handleSave = async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: displayName, summary }),
      });

      if (res.ok) {
        setEditing(false);
        onUpdate();
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to update');
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    setDisplayName(user.display_name);
    setSummary(user.summary);
    setEditing(false);
    setError(null);
  };

  return (
    <div className="view profile-view">
      <header className="view-header">
        <h2>Profile</h2>
        {!editing && (
          <button className="btn btn-secondary" onClick={() => setEditing(true)}>
            Edit
          </button>
        )}
      </header>

      <div className="profile-card card">
        <div className="profile-header">
          <div className="profile-avatar">
            {user.avatar_url ? (
              <img src={user.avatar_url} alt="" />
            ) : (
              <span>{user.display_name[0]}</span>
            )}
          </div>
        </div>

        <div className="profile-body">
          {editing ? (
            <>
              <div className="input-group">
                <label>Display Name</label>
                <input
                  type="text"
                  className="input"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </div>
              <div className="input-group">
                <label>Bio</label>
                <textarea
                  className="textarea"
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  rows={4}
                />
              </div>
              {error && <div className="error-text">{error}</div>}
              <div className="profile-actions">
                <button className="btn btn-secondary" onClick={handleCancel}>
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handleSave}
                  disabled={loading}
                >
                  {loading ? 'Saving...' : 'Save'}
                </button>
              </div>
            </>
          ) : (
            <>
              <h3 className="profile-name">{user.display_name}</h3>
              <p className="profile-handle">@{user.username}</p>
              {user.summary && <p className="profile-bio">{user.summary}</p>}
            </>
          )}
        </div>

        <div className="profile-footer">
          <div className="profile-meta">
            <span className="meta-label">Actor URL</span>
            <code className="meta-value">{actorUrl}</code>
          </div>
          <div className="profile-meta">
            <span className="meta-label">Fediverse Handle</span>
            <code className="meta-value">@{user.username}@{hostname}</code>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
