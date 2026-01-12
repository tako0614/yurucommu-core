import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export type Language = 'ja' | 'en';

const translations = {
  ja: {
    // Navigation
    'nav.groups': 'グループ',
    'nav.messages': 'メッセージ',
    'nav.members': 'メンバー',
    'nav.notifications': '通知',
    'nav.logout': 'ログアウト',

    // Groups
    'groups.title': 'グループ',
    'groups.noGroups': 'グループがありません',
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
    'dm.newMessage': '新規メッセージ',
    'dm.placeholder': 'メッセージを入力...',
    'dm.send': '送信',

    // Notifications
    'notifications.title': '通知',
    'notifications.empty': '通知はありません',
    'notifications.joinRequest': 'がグループへの参加をリクエストしました',
    'notifications.joinAccepted': 'がグループへの参加を承認しました',
    'notifications.mention': 'があなたをメンションしました',
    'notifications.reply': 'があなたのメッセージに返信しました',
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
    'nav.groups': 'Groups',
    'nav.messages': 'Messages',
    'nav.members': 'Members',
    'nav.notifications': 'Notifications',
    'nav.logout': 'Logout',

    // Groups
    'groups.title': 'Groups',
    'groups.noGroups': 'No groups',
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
    'dm.newMessage': 'New message',
    'dm.placeholder': 'Type a message...',
    'dm.send': 'Send',

    // Notifications
    'notifications.title': 'Notifications',
    'notifications.empty': 'No notifications',
    'notifications.joinRequest': ' requested to join the group',
    'notifications.joinAccepted': ' accepted your join request',
    'notifications.mention': ' mentioned you',
    'notifications.reply': ' replied to your message',
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
