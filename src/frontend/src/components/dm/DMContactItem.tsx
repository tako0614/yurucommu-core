import { DMContact } from '../../lib/api';
import { formatConversationListTime } from '../../lib/datetime';

interface DMContactItemProps {
  contact: DMContact;
  onClick: () => void;
  isPinned?: boolean;
  unreadCount?: number;
}


export function DMContactItem({
  contact,
  onClick,
  isPinned = false,
  unreadCount = 0,
}: DMContactItemProps) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-neutral-900 active:bg-neutral-800 transition-colors"
    >
      <div className="relative flex-shrink-0">
        {contact.icon_url ? (
          <img
            src={contact.icon_url}
            alt={contact.name || contact.preferred_username}
            className="w-14 h-14 rounded-full object-cover"
          />
        ) : (
          <div className="w-14 h-14 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white font-bold text-xl">
            {(contact.name || contact.preferred_username)?.[0]?.toUpperCase() || '?'}
          </div>
        )}
        {isPinned && (
          <div className="absolute -top-1 -left-1 w-5 h-5 bg-green-500 rounded-full flex items-center justify-center border-2 border-black">
            <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M16,12V4H17V2H7V4H8V12L6,14V16H11.2V22H12.8V16H18V14L16,12Z" />
            </svg>
          </div>
        )}
        {contact.type === 'community' && (
          <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center border-2 border-black">
            <svg className="w-3.5 h-3.5 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
            </svg>
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0 text-left">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-white truncate text-base">
            {contact.name || contact.preferred_username}
          </span>
          {contact.type === 'community' && contact.member_count !== undefined && (
            <span className="text-xs text-neutral-500">({contact.member_count})</span>
          )}
        </div>
        {contact.last_message ? (
          <p className="text-sm text-neutral-400 truncate mt-0.5">
            {contact.last_message.is_mine ? 'あなた: ' : ''}
            {contact.last_message.content}
          </p>
        ) : (
          <p className="text-sm text-neutral-500 truncate mt-0.5">
            {contact.type === 'community' ? 'グループチャット' : 'メッセージはありません'}
          </p>
        )}
      </div>

      <div className="flex flex-col items-end gap-1">
        <span className="text-xs text-neutral-500">
          {formatConversationListTime(contact.last_message_at)}
        </span>
        {unreadCount > 0 && (
          <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-green-500 text-white text-[10px] font-bold flex items-center justify-center">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </div>
    </button>
  );
}

