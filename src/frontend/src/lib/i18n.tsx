import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export type Language = 'ja' | 'en';

const translations = {
  ja: {
    // Navigation
    'nav.home': 'ホーム',
    'nav.search': '検索',
    'nav.groups': 'グループ',
    'nav.messages': 'メッセージ',
    'nav.members': 'メンバー',
    'nav.notifications': '通知',
    'nav.bookmarks': 'ブックマーク',
    'nav.profile': 'プロフィール',
    'nav.settings': '設定',
    'nav.logout': 'ログアウト',

    // Timeline / Posts
    'timeline.title': 'ホーム',
    'timeline.empty': '投稿がありません',
    'timeline.all': 'すべて',
    'timeline.postsOnly': '投稿のみ',
    'timeline.groupsOnly': 'グループのみ',
    'posts.placeholder': '今なにしてる？',
    'posts.post': '投稿',
    'posts.like': 'いいね',
    'posts.repost': 'リポスト',
    'posts.reply': '返信',
    'posts.delete': '削除',

    // Profile
    'profile.posts': '投稿',
    'profile.likes': 'いいね',
    'profile.noLikes': 'まだいいねがありません',
    'profile.followers': 'フォロワー',
    'profile.following': 'フォロー中',
    'profile.follow': 'フォロー',
    'profile.unfollow': 'フォロー解除',
    'profile.editProfile': 'プロフィールを編集',

    // Timeline tabs
    'timeline.following': 'フォロー中',
    'timeline.communities': 'コミュニティ',

    // Groups
    'groups.title': 'グループ',
    'groups.noGroups': 'グループがありません',
    'groups.create': '作成',
    'groups.createTitle': 'グループを作成',
    'groups.name': '名前',
    'groups.namePlaceholder': 'グループ名を入力',
    'groups.description': '説明',
    'groups.descriptionPlaceholder': 'グループの説明を入力',
    'groups.join': '参加',
    'groups.leave': '退出',
    'groups.pending': '承認待ち',
    'groups.members': 'メンバー',
    'groups.rooms': 'ルーム',

    // Rooms
    'rooms.title': 'ルーム',
    'rooms.noRooms': 'ルームがありません',
    'rooms.chat': 'チャット',
    'rooms.forum': 'フォーラム',

    // Community Chat
    'communityChat.noMessages': 'メッセージはまだありません',
    'communityChat.noMessagesHint': '最初のメッセージを送ってみましょう',
    'communityChat.notFound': 'コミュニティが見つかりません',
    'communityChat.notMember': 'このコミュニティに参加していません',
    'communityChat.backToList': 'コミュニティ一覧へ',
    'communityChat.leave': 'コミュニティを退出',
    'communityChat.leaveConfirm': 'このコミュニティを退出しますか？',

    // Messages
    'messages.placeholder': 'メッセージを入力...',
    'messages.send': '送信',
    'messages.noMessages': 'メッセージがありません',
    'messages.loading': '読み込み中...',
    'messages.loadMore': 'もっと見る',

    // Threads (Forum)
    'threads.title': 'スレッド',
    'threads.noThreads': 'スレッドがありません',
    'threads.newThread': '新規スレッド',
    'threads.replies': '件の返信',
    'threads.reply': '返信',
    'threads.pinned': '固定',
    'threads.locked': 'ロック',

    // Members
    'members.title': 'メンバー',
    'members.noMembers': 'メンバーがいません',
    'members.owner': 'オーナー',
    'members.moderator': 'モデレーター',
    'members.member': 'メンバー',

    // DM
    'dm.title': 'ダイレクトメッセージ',
    'dm.noConversations': '会話がありません',
    'dm.noMessages': 'メッセージを送信',
    'dm.newMessage': '新規メッセージ',
    'dm.placeholder': 'メッセージを入力...',
    'dm.send': '送信',
    'dm.typing': '入力中...',

    // Story
    'story.shareCopied': 'リンクをコピーしました',
    'story.shareFailed': '共有に失敗しました',
    'story.shareRecordFailed': '共有の記録に失敗しました',

    // Notifications
    'notifications.title': '通知',
    'notifications.empty': '通知はありません',
    'notifications.follow': 'があなたをフォローしました',
    'notifications.like': 'があなたの投稿にいいねしました',
    'notifications.repost': 'があなたの投稿をリポストしました',
    'notifications.mention': 'があなたをメンションしました',
    'notifications.reply': 'があなたの投稿に返信しました',
    'notifications.joinRequest': 'がグループへの参加をリクエストしました',
    'notifications.joinAccepted': 'がグループへの参加を承認しました',
    'notifications.invite': 'がグループに招待しました',

    // Common
    'common.loading': '読み込み中...',
    'common.error': 'エラーが発生しました',
    'common.cancel': 'キャンセル',
    'common.save': '保存',
    'common.confirm': '確認',
    'common.delete': '削除',
    'common.edit': '編集',
  },
  en: {
    // Navigation
    'nav.home': 'Home',
    'nav.search': 'Search',
    'nav.groups': 'Groups',
    'nav.messages': 'Messages',
    'nav.members': 'Members',
    'nav.notifications': 'Notifications',
    'nav.bookmarks': 'Bookmarks',
    'nav.profile': 'Profile',
    'nav.settings': 'Settings',
    'nav.logout': 'Logout',

    // Timeline / Posts
    'timeline.title': 'Home',
    'timeline.empty': 'No posts yet',
    'timeline.all': 'All',
    'timeline.postsOnly': 'Posts',
    'timeline.groupsOnly': 'Groups',
    'posts.placeholder': "What's happening?",
    'posts.post': 'Post',
    'posts.like': 'Like',
    'posts.repost': 'Repost',
    'posts.reply': 'Reply',
    'posts.delete': 'Delete',

    // Profile
    'profile.posts': 'Posts',
    'profile.likes': 'Likes',
    'profile.noLikes': 'No likes yet',
    'profile.followers': 'Followers',
    'profile.following': 'Following',
    'profile.follow': 'Follow',
    'profile.unfollow': 'Unfollow',
    'profile.editProfile': 'Edit profile',

    // Timeline tabs
    'timeline.following': 'Following',
    'timeline.communities': 'Communities',

    // Groups
    'groups.title': 'Groups',
    'groups.noGroups': 'No groups',
    'groups.create': 'Create',
    'groups.createTitle': 'Create Group',
    'groups.name': 'Name',
    'groups.namePlaceholder': 'Enter group name',
    'groups.description': 'Description',
    'groups.descriptionPlaceholder': 'Enter group description',
    'groups.join': 'Join',
    'groups.leave': 'Leave',
    'groups.pending': 'Pending',
    'groups.members': 'Members',
    'groups.rooms': 'Rooms',

    // Rooms
    'rooms.title': 'Rooms',
    'rooms.noRooms': 'No rooms',
    'rooms.chat': 'Chat',
    'rooms.forum': 'Forum',

    // Community Chat
    'communityChat.noMessages': 'No messages yet',
    'communityChat.noMessagesHint': 'Send the first message',
    'communityChat.notFound': 'Community not found',
    'communityChat.notMember': 'You are not a member of this community',
    'communityChat.backToList': 'Back to communities',
    'communityChat.leave': 'Leave community',
    'communityChat.leaveConfirm': 'Leave this community?',

    // Messages
    'messages.placeholder': 'Type a message...',
    'messages.send': 'Send',
    'messages.noMessages': 'No messages',
    'messages.loading': 'Loading...',
    'messages.loadMore': 'Load more',

    // Threads (Forum)
    'threads.title': 'Threads',
    'threads.noThreads': 'No threads',
    'threads.newThread': 'New Thread',
    'threads.replies': ' replies',
    'threads.reply': 'Reply',
    'threads.pinned': 'Pinned',
    'threads.locked': 'Locked',

    // Members
    'members.title': 'Members',
    'members.noMembers': 'No members',
    'members.owner': 'Owner',
    'members.moderator': 'Moderator',
    'members.member': 'Member',

    // DM
    'dm.title': 'Direct Messages',
    'dm.noConversations': 'No conversations',
    'dm.noMessages': 'No messages yet',
    'dm.newMessage': 'New message',
    'dm.placeholder': 'Type a message...',
    'dm.send': 'Send',
    'dm.typing': 'Typing...',

    // Story
    'story.shareCopied': 'Link copied',
    'story.shareFailed': 'Failed to share story',
    'story.shareRecordFailed': 'Failed to record share',

    // Notifications
    'notifications.title': 'Notifications',
    'notifications.empty': 'No notifications',
    'notifications.follow': ' followed you',
    'notifications.like': ' liked your post',
    'notifications.repost': ' reposted your post',
    'notifications.mention': ' mentioned you',
    'notifications.reply': ' replied to your post',
    'notifications.joinRequest': ' requested to join the group',
    'notifications.joinAccepted': ' accepted your join request',
    'notifications.invite': ' invited you to a group',

    // Common
    'common.loading': 'Loading...',
    'common.error': 'An error occurred',
    'common.cancel': 'Cancel',
    'common.save': 'Save',
    'common.confirm': 'Confirm',
    'common.delete': 'Delete',
    'common.edit': 'Edit',
  },
} as const;

type TranslationKey = keyof typeof translations.ja;

interface I18nContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: TranslationKey) => string;
}

const I18nContext = createContext<I18nContextType | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(() => {
    const saved = localStorage.getItem('language');
    if (saved === 'ja' || saved === 'en') return saved;
    // Detect browser language
    const browserLang = navigator.language.split('-')[0];
    return browserLang === 'ja' ? 'ja' : 'en';
  });

  useEffect(() => {
    localStorage.setItem('language', language);
  }, [language]);

  const t = (key: TranslationKey): string => {
    return translations[language][key] || key;
  };

  return (
    <I18nContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return context;
}
