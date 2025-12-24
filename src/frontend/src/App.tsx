import React, { useState, useEffect, useCallback } from 'react';

// SVG Icons
const Icons = {
  logo: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  ),
  home: (
    <svg viewBox="0 0 24 24">
      <path d="M12 1.696L.622 8.807l1.06 1.696L3 9.679V19.5C3 20.881 4.119 22 5.5 22h13c1.381 0 2.5-1.119 2.5-2.5V9.679l1.318.824 1.06-1.696L12 1.696zM12 16.5c-1.933 0-3.5-1.567-3.5-3.5s1.567-3.5 3.5-3.5 3.5 1.567 3.5 3.5-1.567 3.5-3.5 3.5z" />
    </svg>
  ),
  homeOutline: (
    <svg viewBox="0 0 24 24">
      <path d="M12 9c-2.209 0-4 1.791-4 4s1.791 4 4 4 4-1.791 4-4-1.791-4-4-4zm0 6c-1.105 0-2-.895-2-2s.895-2 2-2 2 .895 2 2-.895 2-2 2zm0-13.304L.622 8.807l1.06 1.696L3 9.679V19.5C3 20.881 4.119 22 5.5 22h13c1.381 0 2.5-1.119 2.5-2.5V9.679l1.318.824 1.06-1.696L12 1.696zM19 19.5c0 .276-.224.5-.5.5h-13c-.276 0-.5-.224-.5-.5V8.429l7-4.375 7 4.375V19.5z" />
    </svg>
  ),
  bell: (
    <svg viewBox="0 0 24 24">
      <path d="M19.993 9.042C19.48 5.017 16.054 2 11.996 2s-7.49 3.021-7.999 7.051L2.866 18H7.1c.463 2.282 2.481 4 4.9 4s4.437-1.718 4.9-4h4.236l-1.143-8.958zM12 20c-1.306 0-2.417-.835-2.829-2h5.658c-.412 1.165-1.523 2-2.829 2zm-6.866-4l.847-6.698C6.364 6.272 8.941 4 11.996 4s5.627 2.268 6.013 5.295L18.864 16H5.134z" />
    </svg>
  ),
  bellFilled: (
    <svg viewBox="0 0 24 24">
      <path d="M11.996 2c-4.062 0-7.49 3.021-7.999 7.051L2.866 18H7.1c.463 2.282 2.481 4 4.9 4s4.437-1.718 4.9-4h4.236l-1.143-8.958C19.48 5.017 16.054 2 11.996 2zM9.171 18h5.658c-.412 1.165-1.523 2-2.829 2s-2.417-.835-2.829-2z" />
    </svg>
  ),
  user: (
    <svg viewBox="0 0 24 24">
      <path d="M5.651 19h12.698c-.337-1.8-1.023-3.21-1.945-4.19C15.318 13.65 13.838 13 12 13s-3.317.65-4.404 1.81c-.922.98-1.608 2.39-1.945 4.19zm.486-5.56C7.627 11.85 9.648 11 12 11s4.373.85 5.863 2.44c1.477 1.58 2.366 3.8 2.632 6.46l.11 1.1H3.395l.11-1.1c.266-2.66 1.155-4.88 2.632-6.46zM12 4c-1.105 0-2 .9-2 2s.895 2 2 2 2-.9 2-2-.895-2-2-2zM8 6c0-2.21 1.791-4 4-4s4 1.79 4 4-1.791 4-4 4-4-1.79-4-4z" />
    </svg>
  ),
  userFilled: (
    <svg viewBox="0 0 24 24">
      <path d="M17.863 13.44c1.477 1.58 2.366 3.8 2.632 6.46l.11 1.1H3.395l.11-1.1c.266-2.66 1.155-4.88 2.632-6.46C7.627 11.85 9.648 11 12 11s4.373.85 5.863 2.44zM12 2C9.791 2 8 3.79 8 6s1.791 4 4 4 4-1.79 4-4-1.791-4-4-4z" />
    </svg>
  ),
  users: (
    <svg viewBox="0 0 24 24">
      <path d="M7.501 4.001c.828 0 1.5.671 1.5 1.5s-.672 1.5-1.5 1.5-1.5-.671-1.5-1.5.672-1.5 1.5-1.5zm0-2c-1.932 0-3.5 1.567-3.5 3.5s1.568 3.5 3.5 3.5 3.5-1.567 3.5-3.5-1.568-3.5-3.5-3.5zm9 2c.828 0 1.5.671 1.5 1.5s-.672 1.5-1.5 1.5-1.5-.671-1.5-1.5.672-1.5 1.5-1.5zm0-2c-1.932 0-3.5 1.567-3.5 3.5s1.568 3.5 3.5 3.5 3.5-1.567 3.5-3.5-1.568-3.5-3.5-3.5zm4.209 12.539c-.175-.856-.503-1.594-.94-2.214-.868-1.235-2.212-2.008-3.769-2.312-.247-.048-.503.018-.684.178-.395.349-.888.593-1.463.702-.581.109-.916.586-.916 1.088v.022c0 .503.337.979.918 1.088.569.106 1.058.348 1.45.692.183.161.44.228.689.179 1.024-.202 1.905.203 2.421.734.265.271.465.588.592.923.039.106.178.392.178.392.081.199.28.325.493.325h1.246c.323 0 .582-.263.582-.586 0 0-.112-.481-.167-.62-.179-.449-.41-.852-.63-1.193zm-10.211 1.61c.264.27.464.587.591.922.039.106.178.392.178.392.081.199.28.325.493.325h1.245c.323 0 .582-.263.582-.586 0 0-.112-.481-.166-.62-.24-.607-.567-1.136-.962-1.567-.868-1.235-2.212-2.008-3.769-2.312-.247-.048-.503.018-.684.178-.395.349-.888.593-1.463.702-.581.109-.916.586-.916 1.088v.022c0 .503.337.979.918 1.088.569.106 1.058.348 1.45.692.183.161.44.228.689.179 1.024-.202 1.905.204 2.421.735.265.271.465.588.592.923.039.106.178.392.178.392.081.199.28.325.493.325h1.245c.323 0 .582-.263.582-.586 0 0-.112-.481-.166-.62-.18-.449-.411-.852-.631-1.193-.175-.856-.503-1.594-.94-2.214-.435-.619-.979-1.133-1.604-1.522-.153-.096-.31-.184-.47-.266-.161-.082-.325-.156-.494-.223z" />
    </svg>
  ),
  reply: (
    <svg viewBox="0 0 24 24">
      <path d="M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01zm8.005-6c-3.317 0-6.005 2.69-6.005 6 0 3.37 2.77 6.08 6.138 6.01l.351-.01h1.761v2.3l5.087-2.81c1.951-1.08 3.163-3.13 3.163-5.36 0-3.39-2.744-6.13-6.129-6.13H9.756z" />
    </svg>
  ),
  boost: (
    <svg viewBox="0 0 24 24">
      <path d="M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.432 9.48.068 8.02 4.5 3.88zM16.5 6H11V4h5.5c2.209 0 4 1.79 4 4v8.45l2.068-1.93 1.364 1.46-4.432 4.14-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2z" />
    </svg>
  ),
  like: (
    <svg viewBox="0 0 24 24">
      <path d="M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.97 3.257 4.27 7.129 6.61 3.87-2.34 6.052-4.64 7.126-6.61 1.111-2.04 1.03-3.7.477-4.82-.561-1.13-1.666-1.84-2.908-1.91zm4.187 7.69c-1.351 2.48-4.001 5.12-8.379 7.67l-.503.3-.504-.3c-4.379-2.55-7.029-5.19-8.382-7.67-1.36-2.5-1.41-4.86-.514-6.67.887-1.79 2.647-2.91 4.601-3.01 1.651-.09 3.368.56 4.798 2.01 1.429-1.45 3.146-2.1 4.796-2.01 1.954.1 3.714 1.22 4.601 3.01.896 1.81.846 4.17-.514 6.67z" />
    </svg>
  ),
  likeFilled: (
    <svg viewBox="0 0 24 24">
      <path d="M20.884 13.19c-1.351 2.48-4.001 5.12-8.379 7.67l-.503.3-.504-.3c-4.379-2.55-7.029-5.19-8.382-7.67-1.36-2.5-1.41-4.86-.514-6.67.887-1.79 2.647-2.91 4.601-3.01 1.651-.09 3.368.56 4.798 2.01 1.429-1.45 3.146-2.1 4.796-2.01 1.954.1 3.714 1.22 4.601 3.01.896 1.81.846 4.17-.514 6.67z" />
    </svg>
  ),
  share: (
    <svg viewBox="0 0 24 24">
      <path d="M12 2.59l5.7 5.7-1.41 1.42L13 6.41V16h-2V6.41l-3.3 3.3-1.41-1.42L12 2.59zM21 15l-.02 3.51c0 1.38-1.12 2.49-2.5 2.49H5.5C4.11 21 3 19.88 3 18.5V15h2v3.5c0 .28.22.5.5.5h12.98c.28 0 .5-.22.5-.5L19 15h2z" />
    </svg>
  ),
  more: (
    <svg viewBox="0 0 24 24">
      <path d="M3 12c0-1.1.9-2 2-2s2 .9 2 2-.9 2-2 2-2-.9-2-2zm9 2c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm7 0c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2z" />
    </svg>
  ),
  search: (
    <svg viewBox="0 0 24 24">
      <path d="M10.25 3.75c-3.59 0-6.5 2.91-6.5 6.5s2.91 6.5 6.5 6.5c1.795 0 3.419-.726 4.596-1.904 1.178-1.177 1.904-2.801 1.904-4.596 0-3.59-2.91-6.5-6.5-6.5zm-8.5 6.5c0-4.694 3.806-8.5 8.5-8.5s8.5 3.806 8.5 8.5c0 1.986-.682 3.815-1.824 5.262l4.781 4.781-1.414 1.414-4.781-4.781c-1.447 1.142-3.276 1.824-5.262 1.824-4.694 0-8.5-3.806-8.5-8.5z" />
    </svg>
  ),
  image: (
    <svg viewBox="0 0 24 24">
      <path d="M3 5.5C3 4.119 4.119 3 5.5 3h13C19.881 3 21 4.119 21 5.5v13c0 1.381-1.119 2.5-2.5 2.5h-13C4.119 21 3 19.881 3 18.5v-13zM5.5 5c-.276 0-.5.224-.5.5v9.086l3-3 3 3 5-5 3 3V5.5c0-.276-.224-.5-.5-.5h-13zM19 15.414l-3-3-5 5-3-3-3 3V18.5c0 .276.224.5.5.5h13c.276 0 .5-.224.5-.5v-3.086zM9.75 7C8.784 7 8 7.784 8 8.75s.784 1.75 1.75 1.75 1.75-.784 1.75-1.75S10.716 7 9.75 7z" />
    </svg>
  ),
  logout: (
    <svg viewBox="0 0 24 24">
      <path d="M4 18h2v2h12V4H6v2H4V3.5C4 2.67 4.67 2 5.5 2h13c.83 0 1.5.67 1.5 1.5v17c0 .83-.67 1.5-1.5 1.5h-13c-.83 0-1.5-.67-1.5-1.5V18zm2-6l-4 4 4 4v-3h8v-2H6v-3z" />
    </svg>
  ),
  calendar: (
    <svg viewBox="0 0 24 24">
      <path d="M7 4V3h2v1h6V3h2v1h1.5C19.89 4 21 5.12 21 6.5v12c0 1.38-1.11 2.5-2.5 2.5h-13C4.12 21 3 19.88 3 18.5v-12C3 5.12 4.12 4 5.5 4H7zm0 2H5.5c-.27 0-.5.22-.5.5v12c0 .28.23.5.5.5h13c.28 0 .5-.22.5-.5v-12c0-.28-.22-.5-.5-.5H17v1h-2V6H9v1H7V6zm0 6h2v-2H7v2zm4 0h2v-2h-2v2zm6-2h-2v2h2v-2zm-6 4H7v2h4v-2zm2 0h2v2h-2v-2z" />
    </svg>
  ),
  link: (
    <svg viewBox="0 0 24 24">
      <path d="M18.36 5.64c-1.95-1.96-5.11-1.96-7.07 0L9.88 7.05 8.46 5.64l1.42-1.42c2.73-2.73 7.16-2.73 9.9 0 2.73 2.74 2.73 7.17 0 9.9l-1.42 1.42-1.41-1.42 1.41-1.41c1.96-1.96 1.96-5.12 0-7.07zm-2.12 3.53l-7.07 7.07-1.41-1.41 7.07-7.07 1.41 1.41zm-12.02.71l1.42-1.42 1.41 1.42-1.41 1.41c-1.96 1.96-1.96 5.12 0 7.07 1.95 1.96 5.11 1.96 7.07 0l1.41-1.41 1.42 1.41-1.42 1.42c-2.73 2.73-7.16 2.73-9.9 0-2.73-2.74-2.73-7.17 0-9.9z" />
    </svg>
  ),
};

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
    const styleId = 'tenant-theme';
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
        logoUrl={logoUrl}
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
      <RightSidebar />
    </div>
  );
}

function Loading() {
  return (
    <div className="loading-screen">
      <div className="loading-spinner" />
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
          <h1>Create your account</h1>
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
            {loading ? 'Creating...' : 'Next'}
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
  logoUrl,
}: {
  user: User | null;
  currentView: View;
  unreadCount: number;
  onNavigate: (view: View) => void;
  logoUrl: string | null;
}) {
  const handleLogout = async () => {
    await fetch('/api/logout', { method: 'POST' });
    window.location.reload();
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-logo">
          {logoUrl ? <img src={logoUrl} alt="" /> : Icons.logo}
        </div>
      </div>
      <nav className="sidebar-nav">
        <NavItem
          icon={currentView === 'home' ? Icons.home : Icons.homeOutline}
          label="Home"
          active={currentView === 'home'}
          onClick={() => onNavigate('home')}
        />
        <NavItem
          icon={currentView === 'notifications' ? Icons.bellFilled : Icons.bell}
          label="Notifications"
          badge={unreadCount > 0 ? unreadCount : undefined}
          active={currentView === 'notifications'}
          onClick={() => onNavigate('notifications')}
        />
        <NavItem
          icon={Icons.users}
          label="Following"
          active={currentView === 'following'}
          onClick={() => onNavigate('following')}
        />
        <NavItem
          icon={Icons.users}
          label="Followers"
          active={currentView === 'followers'}
          onClick={() => onNavigate('followers')}
        />
        <NavItem
          icon={currentView === 'profile' ? Icons.userFilled : Icons.user}
          label="Profile"
          active={currentView === 'profile'}
          onClick={() => onNavigate('profile')}
        />
      </nav>
      <button className="post-btn">Post</button>
      {user && (
        <div className="sidebar-user" onClick={handleLogout} title="Click to logout">
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
          <div className="more-icon">{Icons.more}</div>
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
  icon: React.ReactNode;
  label: string;
  badge?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}>
      <span className="nav-icon">
        {icon}
        {badge !== undefined && <span className="nav-badge">{badge > 99 ? '99+' : badge}</span>}
      </span>
      <span className="nav-label">{label}</span>
    </button>
  );
}

function RightSidebar() {
  return (
    <aside className="right-sidebar">
      <div className="search-box">
        <div className="search-input-wrapper">
          {Icons.search}
          <input type="text" className="search-input" placeholder="Search" />
        </div>
      </div>
      <div className="widget-box">
        <div className="widget-header">What's happening</div>
        <div className="widget-item">
          <div className="widget-item-title">Welcome to Takos</div>
          <div className="widget-item-desc">A federated social network</div>
        </div>
        <button className="widget-show-more">Show more</button>
      </div>
      <div className="footer-links">
        <span>Powered by Takos</span>
      </div>
    </aside>
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
    <>
      <header className="view-header">
        <div className="view-header-content">
          <h2>Home</h2>
        </div>
      </header>
      <Composer user={user} onPost={onRefresh} maxPostLength={maxPostLength} />
      <div className="timeline">
        {posts.length === 0 ? (
          <div className="empty-state">
            <h3>Welcome to Takos</h3>
            <p>This is your home timeline. Start by posting something or following others!</p>
          </div>
        ) : (
          posts.map((post) => (
            <PostCard key={post.id} post={post} user={user} features={features} />
          ))
        )}
      </div>
    </>
  );
}

function Composer({ user, onPost, maxPostLength }: { user: User | null; onPost: () => void; maxPostLength: number }) {
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

  const remaining = maxPostLength - content.length;
  const charCountClass = remaining < 0 ? 'danger' : remaining < 20 ? 'warning' : '';

  return (
    <div className="composer">
      <div className="composer-avatar">
        {user?.avatar_url ? (
          <img src={user.avatar_url} alt="" />
        ) : (
          <span>{user?.display_name?.[0] || '?'}</span>
        )}
      </div>
      <form className="composer-form" onSubmit={handleSubmit}>
        <textarea
          className="composer-input"
          placeholder="What is happening?!"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={1}
        />
        <div className="composer-footer">
          <div className="composer-actions">
            <button type="button" className="composer-action-btn" title="Media">
              {Icons.image}
            </button>
          </div>
          <div className="composer-submit">
            {content.length > 0 && (
              <span className={`char-count ${charCountClass}`}>{remaining}</span>
            )}
            <button
              type="submit"
              className="btn-post"
              disabled={loading || !content.trim() || content.length > maxPostLength}
            >
              {loading ? 'Posting...' : 'Post'}
            </button>
          </div>
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
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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
          <span className="post-separator">·</span>
          <span className="post-time">{formatTime(post.published_at)}</span>
          <button className="post-more">{Icons.more}</button>
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
          <button className="action-btn reply" title="Reply" disabled={!features.enableReplies}>
            {Icons.reply}
          </button>
          <button className="action-btn boost" title="Repost" disabled={!features.enableBoosts}>
            {Icons.boost}
          </button>
          <button className="action-btn like" title="Like" disabled={!features.enableLikes}>
            {Icons.like}
          </button>
          <button className="action-btn share" title="Share">
            {Icons.share}
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

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'follow':
        return <span className="notification-icon follow">{Icons.user}</span>;
      case 'like':
        return <span className="notification-icon like">{Icons.likeFilled}</span>;
      case 'boost':
        return <span className="notification-icon boost">{Icons.boost}</span>;
      default:
        return <span className="notification-icon">{Icons.bell}</span>;
    }
  };

  const getNotificationText = (notification: Notification) => {
    const actor = notification.actor;
    const name = actor?.name || actor?.preferredUsername || 'Someone';

    switch (notification.type) {
      case 'follow':
        return <><strong>{name}</strong> followed you</>;
      case 'like':
        return <><strong>{name}</strong> liked your post</>;
      case 'boost':
        return <><strong>{name}</strong> reposted your post</>;
      case 'mention':
        return <><strong>{name}</strong> mentioned you</>;
      case 'reply':
        return <><strong>{name}</strong> replied to your post</>;
      default:
        return <><strong>{name}</strong> interacted with you</>;
    }
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (hours < 24) return `${hours}h`;
    if (days < 7) return `${days}d`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <>
      <header className="view-header">
        <div className="view-header-content">
          <h2>Notifications</h2>
          {notifications.some(n => !n.read) && (
            <button className="btn btn-secondary" onClick={markAllRead}>
              Mark all read
            </button>
          )}
        </div>
      </header>
      <div className="notifications-list">
        {notifications.length === 0 ? (
          <div className="empty-state">
            <h3>Nothing to see here yet</h3>
            <p>When someone interacts with you, you'll see it here</p>
          </div>
        ) : (
          notifications.map((notification) => (
            <div
              key={notification.id}
              className={`notification-item ${!notification.read ? 'unread' : ''}`}
            >
              {getNotificationIcon(notification.type)}
              <div className="notification-content">
                <div className="notification-actors">
                  <div className="notification-avatar">
                    {notification.actor?.icon?.url ? (
                      <img src={notification.actor.icon.url} alt="" />
                    ) : (
                      <span>{(notification.actor?.name || '?')[0]}</span>
                    )}
                  </div>
                </div>
                <p className="notification-text">{getNotificationText(notification)}</p>
                <span className="notification-time">{formatTime(notification.created_at)}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </>
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
    <>
      <header className="view-header">
        <div className="view-header-content">
          <h2>Following</h2>
          <span className="count">{following.length}</span>
        </div>
      </header>
      <div className="follow-form">
        <h3>Follow someone</h3>
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
              {loading ? '...' : 'Follow'}
            </button>
          </div>
          {error && <div className="error-text">{error}</div>}
        </form>
      </div>
      <div className="follow-list">
        {following.length === 0 ? (
          <div className="empty-state">
            <h3>You aren't following anyone yet</h3>
            <p>Enter an account address above to follow someone!</p>
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
    </>
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
    <>
      <header className="view-header">
        <div className="view-header-content">
          <h2>Followers</h2>
          <span className="count">{followers.length}</span>
        </div>
      </header>
      {pending.length > 0 && (
        <div className="follow-requests">
          <h3>Follow requests</h3>
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
                    Decline
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
            <h3>You don't have any followers yet</h3>
            <p>When someone follows you, they'll show up here</p>
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
    </>
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
    <>
      <header className="view-header">
        <div className="view-header-content">
          <h2>{user.display_name}</h2>
        </div>
      </header>
      <div className="profile-header-banner">
        {user.header_url && <img src={user.header_url} alt="" />}
      </div>
      <div className="profile-header-info">
        <div className="profile-avatar">
          {user.avatar_url ? (
            <img src={user.avatar_url} alt="" />
          ) : (
            <span>{user.display_name[0]}</span>
          )}
        </div>
        <div className="profile-actions-bar">
          {!editing ? (
            <button className="btn btn-secondary" onClick={() => setEditing(true)}>
              Edit profile
            </button>
          ) : (
            <div className="follow-actions">
              <button className="btn btn-secondary" onClick={handleCancel}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleSave} disabled={loading}>
                {loading ? 'Saving...' : 'Save'}
              </button>
            </div>
          )}
        </div>
        {editing ? (
          <div className="profile-edit-form">
            {error && <div className="error-message">{error}</div>}
            <div className="input-group">
              <label>Name</label>
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
          </div>
        ) : (
          <>
            <h3 className="profile-name">{user.display_name}</h3>
            <p className="profile-handle">@{user.username}</p>
            {user.summary && <p className="profile-bio">{user.summary}</p>}
            <div className="profile-meta">
              <div className="profile-meta-item">
                {Icons.link}
                <span>{hostname}</span>
              </div>
            </div>
          </>
        )}
      </div>
      <div className="profile-footer">
        <div className="profile-footer-meta">
          <span className="meta-label">Fediverse Handle</span>
          <code className="meta-value">@{user.username}@{hostname}</code>
        </div>
        <div className="profile-footer-meta">
          <span className="meta-label">Actor URL</span>
          <code className="meta-value">{actorUrl}</code>
        </div>
      </div>
    </>
  );
}

export default App;
