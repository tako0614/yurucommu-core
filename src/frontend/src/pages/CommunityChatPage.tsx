import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Actor } from '../types';
import {
  CommunityDetail,
  CommunityMessage,
  CommunityMember,
  fetchCommunity,
  fetchCommunityMessages,
  fetchCommunityMembers,
  sendCommunityMessage,
  leaveCommunity,
} from '../lib/api';
import { useI18n } from '../lib/i18n';
import { formatChatDateHeader, formatTime } from '../lib/datetime';
import { UserAvatar } from '../components/UserAvatar';

interface CommunityChatPageProps {
  actor: Actor;
}

const BackIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
  </svg>
);

const SendIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
  </svg>
);

const UsersIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
  </svg>
);

const CloseIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);

function MembersModal({
  community,
  members,
  onClose,
}: {
  community: CommunityDetail;
  members: CommunityMember[];
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
      <div className="bg-neutral-900 rounded-xl w-full max-w-md max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-neutral-800">
          <h2 className="text-lg font-bold text-white">繝｡繝ｳ繝舌・ ({members.length})</h2>
          <button onClick={onClose} aria-label="Close" className="text-neutral-400 hover:text-white">
            <CloseIcon />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {members.map(member => (
            <Link
              key={member.ap_id}
              to={`/profile/${encodeURIComponent(member.ap_id)}`}
              className="flex items-center gap-3 px-4 py-3 hover:bg-neutral-800 transition-colors"
              onClick={onClose}
            >
              <UserAvatar
                avatarUrl={member.icon_url}
                name={member.name || member.preferred_username}
                size={44}
              />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-white truncate">
                  {member.name || member.preferred_username}
                </div>
                <div className="text-sm text-neutral-500 truncate">
                  @{member.username}
                </div>
              </div>
              {member.role === 'owner' && (
                <span className="px-2 py-0.5 text-xs bg-yellow-500/20 text-yellow-400 rounded">
                  繧ｪ繝ｼ繝翫・
                </span>
              )}
              {member.role === 'moderator' && (
                <span className="px-2 py-0.5 text-xs bg-blue-500/20 text-blue-400 rounded">
                  繝｢繝・Ξ繝ｼ繧ｿ繝ｼ
                </span>
              )}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

export function CommunityChatPage({ actor }: CommunityChatPageProps) {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const { t } = useI18n();

  const [community, setCommunity] = useState<CommunityDetail | null>(null);
  const [messages, setMessages] = useState<CommunityMessage[]>([]);
  const [members, setMembers] = useState<CommunityMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [inputValue, setInputValue] = useState('');
  const [sending, setSending] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    if (!name) return;
    loadData();
  }, [name]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const loadData = async () => {
    if (!name) return;
    setErrorMessage(null);
    try {
      const [communityData, messagesData, membersData] = await Promise.all([
        fetchCommunity(name),
        fetchCommunityMessages(name),
        fetchCommunityMembers(name),
      ]);
      setCommunity(communityData);
      setMessages(messagesData);
      setMembers(membersData);
    } catch (e) {
      console.error('Failed to load community:', e);
      setErrorMessage(t('common.error'));
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async () => {
    if (!inputValue.trim() || !name || sending) return;

    const content = inputValue.trim();
    setInputValue('');
    setSending(true);
    setErrorMessage(null);

    try {
      const message = await sendCommunityMessage(name, content);
      setMessages(prev => [...prev, message]);
    } catch (e) {
      console.error('Failed to send message:', e);
      setInputValue(content);
      setErrorMessage(t('common.error'));
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleLeave = async () => {
    if (!name || !community) return;
    if (!confirm(t('communityChat.leaveConfirm'))) return;

    try {
      await leaveCommunity(name);
      navigate('/groups');
    } catch (e) {
      console.error('Failed to leave:', e);
      setErrorMessage(t('common.error'));
    }
  };


  // Group messages by date
  const groupedMessages: { date: string; messages: CommunityMessage[] }[] = [];
  let currentDate = '';
  for (const msg of messages) {
    const msgDate = new Date(msg.created_at).toDateString();
    if (msgDate !== currentDate) {
      currentDate = msgDate;
      groupedMessages.push({ date: msg.created_at, messages: [msg] });
    } else {
      groupedMessages[groupedMessages.length - 1].messages.push(msg);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-black">
        <div className="text-neutral-500">{t('messages.loading')}</div>
      </div>
    );
  }

  if (!community) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-black">
        <div className="text-neutral-500 mb-4">{t('communityChat.notFound')}</div>
        <button
          onClick={() => navigate('/groups')}
          className="px-4 py-2 bg-neutral-800 text-white rounded-lg hover:bg-neutral-700 transition-colors"
        >
          {t('communityChat.backToList')}
        </button>
      </div>
    );
  }

  if (!community.is_member) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-black">
        <div className="text-neutral-500 mb-4">{t('communityChat.notMember')}</div>
        <button
          onClick={() => navigate('/groups')}
          className="px-4 py-2 bg-neutral-800 text-white rounded-lg hover:bg-neutral-700 transition-colors"
        >
          {t('communityChat.backToList')}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-black">
      {/* Header */}
      <header className="sticky top-0 bg-black/90 backdrop-blur-sm z-10 border-b border-neutral-900">
        <div className="flex items-center gap-3 px-2 py-2">
          <button
            onClick={() => navigate('/groups')}
            aria-label="Back"
            className="p-2 text-neutral-400 hover:text-white transition-colors"
          >
            <BackIcon />
          </button>

          <div className="w-10 h-10 rounded-full bg-neutral-800 flex items-center justify-center overflow-hidden">
            {community.icon_url ? (
              <img src={community.icon_url} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="text-lg font-medium text-white">
                {(community.display_name || community.name).charAt(0).toUpperCase()}
              </span>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="font-semibold text-white truncate">
              {community.display_name || community.name}
            </div>
            <div className="text-xs text-neutral-500">{community.member_count}莠ｺ</div>
          </div>

          <button
            onClick={() => setShowMembers(true)}
            aria-label="View members"
            className="p-2 text-neutral-400 hover:text-white transition-colors"
          >
            <UsersIcon />
          </button>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {errorMessage && (
          <div className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {errorMessage}
          </div>
        )}
        {messages.length === 0 ? (
          <div className="text-center text-neutral-500 py-8">
            <p>{t('communityChat.noMessages')}</p>
            <p className="text-sm mt-2">{t('communityChat.noMessagesHint')}</p>
          </div>
        ) : (
          groupedMessages.map((group, groupIndex) => (
            <div key={groupIndex}>
              {/* Date header */}
              <div className="flex justify-center my-4">
                <span className="px-3 py-1 text-xs text-neutral-500 bg-neutral-900 rounded-full">
                  {formatChatDateHeader(group.date)}
                </span>
              </div>

              {/* Messages for this date */}
              {group.messages.map((msg, msgIndex) => {
                const isMe = msg.sender.ap_id === actor.ap_id;
                const showAvatar =
                  msgIndex === 0 ||
                  group.messages[msgIndex - 1].sender.ap_id !== msg.sender.ap_id;

                return (
                  <div
                    key={msg.id}
                    className={`flex gap-2 mb-1 ${isMe ? 'flex-row-reverse' : ''}`}
                  >
                    {!isMe && (
                      <div className="w-8 flex-shrink-0">
                        {showAvatar && (
                          <Link to={`/profile/${encodeURIComponent(msg.sender.ap_id)}`}>
                            <UserAvatar
                              avatarUrl={msg.sender.icon_url}
                              name={msg.sender.name || msg.sender.preferred_username}
                              size={32}
                            />
                          </Link>
                        )}
                      </div>
                    )}

                    <div className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} max-w-[70%]`}>
                      {showAvatar && !isMe && (
                        <span className="text-xs text-neutral-500 mb-1 ml-1">
                          {msg.sender.name || msg.sender.preferred_username}
                        </span>
                      )}
                      <div className="flex items-end gap-2">
                        {isMe && (
                          <span className="text-xs text-neutral-600">{formatTime(msg.created_at)}</span>
                        )}
                        <div
                          className={`px-3 py-2 rounded-2xl break-words ${
                            isMe
                              ? 'bg-blue-500 text-white rounded-br-sm'
                              : 'bg-neutral-800 text-white rounded-bl-sm'
                          }`}
                        >
                          {msg.content}
                        </div>
                        {!isMe && (
                          <span className="text-xs text-neutral-600">{formatTime(msg.created_at)}</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="sticky bottom-0 bg-black border-t border-neutral-900 px-4 py-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('messages.placeholder')}
            rows={1}
            className="flex-1 bg-neutral-800 text-white rounded-2xl px-4 py-2 outline-none resize-none max-h-32 focus:ring-2 focus:ring-blue-500"
            style={{ minHeight: '40px' }}
          />
          <button
            onClick={handleSend}
            disabled={!inputValue.trim() || sending}
            aria-label="Send message"
            className="p-2 bg-blue-500 text-white rounded-full hover:bg-blue-600 transition-colors disabled:opacity-50"
          >
            <SendIcon />
          </button>
        </div>

        {/* Leave button */}
        <button
          onClick={handleLeave}
          className="mt-3 w-full text-center text-sm text-red-400 hover:text-red-300 transition-colors"
        >
          {t('communityChat.leave')}
        </button>
      </div>

      {/* Members Modal */}
      {showMembers && (
        <MembersModal
          community={community}
          members={members}
          onClose={() => setShowMembers(false)}
        />
      )}
    </div>
  );
}















