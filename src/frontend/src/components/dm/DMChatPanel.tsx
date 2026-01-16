import { useState, useEffect, useCallback, useRef } from 'react';
import { Actor, DMMessage } from '../../types';
import {
  DMContact,
  fetchUserDMMessages,
  sendUserDMMessage,
  fetchCommunityMessages,
  sendCommunityMessage,
  CommunityMessage,
  fetchUserDMTyping,
  sendUserDMTyping,
  markDMAsRead,
} from '../../lib/api';
import { formatTime } from '../../lib/datetime';
import { useI18n } from '../../lib/i18n';

interface DMChatPanelProps {
  contact: DMContact;
  actor: Actor;
  onBack: () => void;
  onRead?: () => void;
}

export function DMChatPanel({ contact, actor, onBack, onRead }: DMChatPanelProps) {
  const [messages, setMessages] = useState<(DMMessage | CommunityMessage)[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastTypingSentRef = useRef(0);
  const { t } = useI18n();

  const loadMessages = useCallback(async () => {
    setErrorMessage(null);
    try {
      if (contact.type === 'community') {
        const data = await fetchCommunityMessages(contact.ap_id);
        setMessages(data);
      } else {
        const { messages } = await fetchUserDMMessages(contact.ap_id);
        setMessages(messages);
        try {
          await markDMAsRead(contact.ap_id);
          onRead?.();
        } catch {
          // Ignore read marking errors.
        }
      }
    } catch (e) {
      console.error('Failed to load messages:', e);
      setErrorMessage(t('common.error'));
    } finally {
      setLoading(false);
    }
  }, [contact.ap_id, contact.type, onRead, t]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (contact.type !== 'user') {
      setIsTyping(false);
      return;
    }

    let cancelled = false;
    const pollTyping = async () => {
      try {
        const typing = await fetchUserDMTyping(contact.ap_id);
        if (!cancelled) {
          setIsTyping(typing.is_typing);
        }
      } catch {
        if (!cancelled) {
          setIsTyping(false);
        }
      }
    };

    pollTyping();
    const intervalId = window.setInterval(pollTyping, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [contact.ap_id, contact.type]);

  const sendTyping = useCallback(async (value: string) => {
    if (contact.type !== 'user') return;
    if (!value.trim()) return;
    const now = Date.now();
    if (now - lastTypingSentRef.current < 2000) return;
    lastTypingSentRef.current = now;
    try {
      await sendUserDMTyping(contact.ap_id);
    } catch (e) {
      console.error('Failed to send typing:', e);
    }
  }, [contact.ap_id, contact.type]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || sending) return;

    setSending(true);
    setErrorMessage(null);
    try {
      if (contact.type === 'community') {
        const newMsg = await sendCommunityMessage(contact.ap_id, input.trim());
        setMessages(prev => [...prev, newMsg]);
      } else {
        const { message } = await sendUserDMMessage(contact.ap_id, input.trim());
        setMessages(prev => [...prev, message]);
      }
      setInput('');
    } catch (e) {
      console.error('Failed to send message:', e);
      setErrorMessage(t('common.error'));
    } finally {
      setSending(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInput(value);
    void sendTyping(value);
  };

  const getSenderApId = (msg: DMMessage | CommunityMessage): string => {
    return msg.sender.ap_id;
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-neutral-900 bg-black/80 backdrop-blur-sm">
        <button onClick={onBack} aria-label="Back" className="text-neutral-400 hover:text-white transition-colors">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        {contact.icon_url ? (
          <img
            src={contact.icon_url}
            alt={contact.name || contact.preferred_username}
            className="w-10 h-10 rounded-full object-cover"
          />
        ) : (
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white font-bold">
            {(contact.name || contact.preferred_username)?.[0]?.toUpperCase() || '?'}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-white truncate">
            {contact.name || contact.preferred_username}
          </div>
          <div className="text-xs text-neutral-500 truncate">
            @{contact.preferred_username}
            {contact.type === 'community' && contact.member_count !== undefined && (
              <span className="ml-2">{contact.member_count}人</span>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {loading ? (
          <div className="text-center text-neutral-500">Loading...</div>
        ) : messages.length === 0 ? (
          <div className="text-center text-neutral-500">
            {contact.type === 'community' ? t('communityChat.noMessages') : t('dm.noMessages')}
          </div>
        ) : (
          messages.map((msg, index) => {
            const isMine = getSenderApId(msg) === actor.ap_id;
            const showAvatar = !isMine && (
              index === 0 || getSenderApId(messages[index - 1]) !== getSenderApId(msg)
            );

            return (
              <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'} mb-2`}>
                {!isMine && showAvatar ? (
                  <img
                    src={msg.sender.icon_url || ''}
                    alt={msg.sender.name || msg.sender.preferred_username}
                    className="w-8 h-8 rounded-full mr-2 object-cover"
                  />
                ) : (
                  !isMine && <div className="w-8 mr-2" />
                )}
                <div className={`max-w-[70%] ${isMine ? 'text-right' : 'text-left'}`}>
                  {!isMine && showAvatar && (
                    <div className="text-xs text-neutral-500 mb-1">
                      {msg.sender.name || msg.sender.preferred_username}
                    </div>
                  )}
                  <div className={`inline-block px-4 py-2 rounded-2xl ${
                    isMine
                      ? 'bg-blue-500 text-white rounded-br-sm'
                      : 'bg-neutral-800 text-white rounded-bl-sm'
                  }`}>
                    <p className="text-sm">{msg.content}</p>
                  </div>
                  <div className="text-xs text-neutral-500 mt-1">
                    {formatTime(msg.created_at)}
                  </div>
                </div>
              </div>
            );
          })
        )}
        {contact.type === 'user' && isTyping && (
          <div className="text-xs text-neutral-500 mt-2">{t('dm.typing')}</div>
        )}
        {errorMessage && (
          <div className="mt-4 text-center text-red-400 text-sm">{errorMessage}</div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSend} className="p-4 border-t border-neutral-900">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={handleInputChange}
            placeholder={t('dm.placeholder')}
            className="flex-1 px-4 py-2 bg-neutral-900 border border-neutral-800 rounded-full text-white placeholder-neutral-500 focus:outline-none focus:border-blue-500"
          />
          <button
            type="submit"
            disabled={!input.trim() || sending}
            aria-label="Send message"
            className="px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-neutral-700 disabled:cursor-not-allowed text-white rounded-full font-medium transition-colors"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          </button>
        </div>
      </form>
    </div>
  );
}
