import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export type Language = 'ja' | 'en';

const translations = {
  ja: {
    // Navigation
    'nav.home': '繝帙・繝',
    'nav.search': '讀懃ｴ｢',
    'nav.groups': '繧ｰ繝ｫ繝ｼ繝・,
    'nav.messages': '繝｡繝・そ繝ｼ繧ｸ',
    'nav.members': '繝｡繝ｳ繝舌・',
    'nav.notifications': '騾夂衍',
    'nav.bookmarks': '繝悶ャ繧ｯ繝槭・繧ｯ',
    'nav.profile': '繝励Ο繝輔ぅ繝ｼ繝ｫ',
    'nav.settings': '險ｭ螳・,
    'nav.logout': '繝ｭ繧ｰ繧｢繧ｦ繝・,

    // Timeline / Posts
    'timeline.title': '繝帙・繝',
    'timeline.empty': '謚慕ｨｿ縺後≠繧翫∪縺帙ｓ',
    'timeline.all': '縺吶∋縺ｦ',
    'timeline.postsOnly': '謚慕ｨｿ縺ｮ縺ｿ',
    'timeline.groupsOnly': '繧ｰ繝ｫ繝ｼ繝励・縺ｿ',
    'posts.placeholder': '莉翫↑縺ｫ縺励※繧具ｼ・,
    'posts.post': '謚慕ｨｿ',
    'posts.like': '縺・＞縺ｭ',
    'posts.repost': '繝ｪ繝昴せ繝・,
    'posts.reply': '霑比ｿ｡',
    'posts.delete': '蜑企勁',

    // Profile
    'profile.posts': '謚慕ｨｿ',
    'profile.likes': '縺・＞縺ｭ',
    'profile.noLikes': '縺ｾ縺縺・＞縺ｭ縺後≠繧翫∪縺帙ｓ',
    'profile.followers': '繝輔か繝ｭ繝ｯ繝ｼ',
    'profile.following': '繝輔か繝ｭ繝ｼ荳ｭ',
    'profile.follow': '繝輔か繝ｭ繝ｼ',
    'profile.unfollow': '繝輔か繝ｭ繝ｼ隗｣髯､',
    'profile.editProfile': '繝励Ο繝輔ぅ繝ｼ繝ｫ繧堤ｷｨ髮・,

    // Timeline tabs
    'timeline.following': '繝輔か繝ｭ繝ｼ荳ｭ',
    'timeline.communities': '繧ｳ繝溘Η繝九ユ繧｣',

    // Groups
    'groups.title': '繧ｰ繝ｫ繝ｼ繝・,
    'groups.noGroups': '繧ｰ繝ｫ繝ｼ繝励′縺ゅｊ縺ｾ縺帙ｓ',
    'groups.create': '菴懈・',
    'groups.createTitle': '繧ｰ繝ｫ繝ｼ繝励ｒ菴懈・',
    'groups.name': '蜷榊燕',
    'groups.namePlaceholder': '繧ｰ繝ｫ繝ｼ繝怜錐繧貞・蜉・,
    'groups.description': '隱ｬ譏・,
    'groups.descriptionPlaceholder': '繧ｰ繝ｫ繝ｼ繝励・隱ｬ譏弱ｒ蜈･蜉・,
    'groups.join': '蜿ょ刈',
    'groups.leave': '騾蜃ｺ',
    'groups.pending': '謇ｿ隱榊ｾ・■',
    'groups.members': '繝｡繝ｳ繝舌・',
    'groups.rooms': '繝ｫ繝ｼ繝',

    // Rooms
    'rooms.title': '繝ｫ繝ｼ繝',
    'rooms.noRooms': '繝ｫ繝ｼ繝縺後≠繧翫∪縺帙ｓ',
    'rooms.chat': '繝√Ε繝・ヨ',
    'rooms.forum': '繝輔か繝ｼ繝ｩ繝',

    // Community Chat
    'communityChat.noMessages': 'メッセージはまだありません',
    'communityChat.noMessagesHint': '最初のメッセージを送ってみましょう',
    'communityChat.notFound': 'コミュニティが見つかりません',
    'communityChat.notMember': 'このコミュニティに参加していません',
    'communityChat.backToList': 'コミュニティ一覧へ',
    'communityChat.leave': 'コミュニティを退出',
    'communityChat.leaveConfirm': 'このコミュニティを退出しますか？',

    // Messages
    'messages.placeholder': '繝｡繝・そ繝ｼ繧ｸ繧貞・蜉・..',
    'messages.send': '騾∽ｿ｡',
    'messages.noMessages': '繝｡繝・そ繝ｼ繧ｸ縺後≠繧翫∪縺帙ｓ',
    'messages.loading': '隱ｭ縺ｿ霎ｼ縺ｿ荳ｭ...',
    'messages.loadMore': '繧ゅ▲縺ｨ隕九ｋ',

    // Threads (Forum)
    'threads.title': '繧ｹ繝ｬ繝・ラ',
    'threads.noThreads': '繧ｹ繝ｬ繝・ラ縺後≠繧翫∪縺帙ｓ',
    'threads.newThread': '譁ｰ隕上せ繝ｬ繝・ラ',
    'threads.replies': '莉ｶ縺ｮ霑比ｿ｡',
    'threads.reply': '霑比ｿ｡',
    'threads.pinned': '蝗ｺ螳・,
    'threads.locked': '繝ｭ繝・け',

    // Members
    'members.title': '繝｡繝ｳ繝舌・',
    'members.noMembers': '繝｡繝ｳ繝舌・縺後＞縺ｾ縺帙ｓ',
    'members.owner': '繧ｪ繝ｼ繝翫・',
    'members.moderator': '繝｢繝・Ξ繝ｼ繧ｿ繝ｼ',
    'members.member': '繝｡繝ｳ繝舌・',

    // DM
    'dm.title': '繝繧､繝ｬ繧ｯ繝医Γ繝・そ繝ｼ繧ｸ',
    'dm.noConversations': '莨夊ｩｱ縺後≠繧翫∪縺帙ｓ',
    'dm.noMessages': '繝｡繝・そ繝ｼ繧ｸ繧帝∽ｿ｡',
    'dm.newMessage': '譁ｰ隕上Γ繝・そ繝ｼ繧ｸ',
    'dm.placeholder': '繝｡繝・そ繝ｼ繧ｸ繧貞・蜉・..',
    'dm.send': '騾∽ｿ｡',
    'dm.typing': '入力中...',
    // Story
    'story.shareCopied': 'リンクをコピーしました',
    'story.shareFailed': '共有に失敗しました',
    'story.shareRecordFailed': '共有の記録に失敗しました',



    // Notifications
    'notifications.title': '騾夂衍',
    'notifications.empty': '騾夂衍縺ｯ縺ゅｊ縺ｾ縺帙ｓ',
    'notifications.follow': '縺後≠縺ｪ縺溘ｒ繝輔か繝ｭ繝ｼ縺励∪縺励◆',
    'notifications.like': '縺後≠縺ｪ縺溘・謚慕ｨｿ縺ｫ縺・＞縺ｭ縺励∪縺励◆',
    'notifications.repost': '縺後≠縺ｪ縺溘・謚慕ｨｿ繧偵Μ繝昴せ繝医＠縺ｾ縺励◆',
    'notifications.mention': '縺後≠縺ｪ縺溘ｒ繝｡繝ｳ繧ｷ繝ｧ繝ｳ縺励∪縺励◆',
    'notifications.reply': '縺後≠縺ｪ縺溘・謚慕ｨｿ縺ｫ霑比ｿ｡縺励∪縺励◆',
    'notifications.joinRequest': '縺後げ繝ｫ繝ｼ繝励∈縺ｮ蜿ょ刈繧偵Μ繧ｯ繧ｨ繧ｹ繝医＠縺ｾ縺励◆',
    'notifications.joinAccepted': '縺後げ繝ｫ繝ｼ繝励∈縺ｮ蜿ょ刈繧呈価隱阪＠縺ｾ縺励◆',
    'notifications.invite': '縺後げ繝ｫ繝ｼ繝励↓諡帛ｾ・＠縺ｾ縺励◆',

    // Common
    'common.loading': '隱ｭ縺ｿ霎ｼ縺ｿ荳ｭ...',
    'common.error': '繧ｨ繝ｩ繝ｼ縺檎匱逕溘＠縺ｾ縺励◆',
    'common.cancel': '繧ｭ繝｣繝ｳ繧ｻ繝ｫ',
    'common.save': '菫晏ｭ・,
    'common.confirm': '遒ｺ隱・,
    'common.delete': '蜑企勁',
    'common.edit': '邱ｨ髮・,
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


