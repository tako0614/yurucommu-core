import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Actor, DMMessage } from '../types';
import {
  fetchDMContacts,
  DMContact,
  fetchUserDMMessages,
  sendUserDMMessage,
  fetchCommunityMessages,
  sendCommunityMessage,
  CommunityMessage,
} from '../lib/api';

interface DMPageProps {
  actor: Actor;
}

type TabType = 'communities' | 'friends';

// Contact item in the list
function ContactItem({
  contact,
  onClick,
}: {
  contact: DMContact;
  onClick: () => void;
}) {
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
            <span className="text-xs text-neutral-500">{contact.member_count}人</span>
          )}
        </div>
        {contact.last_message ? (
          <p className="text-sm text-neutral-400 truncate mt-0.5">
            {contact.last_message.is_mine ? 'あなた: ' : ''}
            {contact.last_message.content}
          </p>
        ) : (
          <p className="text-sm text-neutral-500 truncate mt-0.5">
            {contact.type === 'community' ? 'グループチャット' : 'メッセージを送信'}
          </p>
        )}
      </div>
      <svg className="w-5 h-5 text-neutral-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </button>
  );
}

// Chat component for both users and communities
function Chat({
  contact,
  actor,
  onBack,
}: {
  contact: DMContact;
  actor: Actor;
  onBack: () => void;
}) {
  const [messages, setMessages] = useState<(DMMessage | CommunityMessage)[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const loadMessages = useCallback(async () => {
    try {
      if (contact.type === 'community') {
        const data = await fetchCommunityMessages(contact.ap_id);
        setMessages(data);
      } else {
        const { messages } = await fetchUserDMMessages(contact.ap_id);
        setMessages(messages);
      }
    } catch (e) {
      console.error('Failed to load messages:', e);
    } finally {
      setLoading(false);
    }
  }, [contact]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || sending) return;

    setSending(true);
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
    } finally {
      setSending(false);
    }
  };

  const getSenderApId = (msg: DMMessage | CommunityMessage): string => {
    return msg.sender.ap_id;
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-neutral-900 bg-black/80 backdrop-blur-sm">
        <button onClick={onBack} className="text-neutral-400 hover:text-white transition-colors">
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
        <div className="flex-1">
          <span className="font-bold text-white">
            {contact.name || contact.preferred_username}
          </span>
          {contact.type === 'community' && (
            <p className="text-xs text-neutral-500">{contact.member_count}人のメンバー</p>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loading ? (
          <div className="text-center text-neutral-500 py-8">Loading...</div>
        ) : messages.length === 0 ? (
          <div className="text-center text-neutral-500 py-8">
            メッセージを送信して会話を始めましょう
          </div>
        ) : (
          messages.map((msg) => {
            const isMe = getSenderApId(msg) === actor.ap_id;
            return (
              <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                <div className="flex items-end gap-2 max-w-[80%]">
                  {!isMe && contact.type === 'community' && (
                    <img
                      src={msg.sender.icon_url || ''}
                      alt={msg.sender.name || msg.sender.preferred_username}
                      className="w-6 h-6 rounded-full object-cover flex-shrink-0"
                    />
                  )}
                  <div
                    className={`px-4 py-2 rounded-2xl ${
                      isMe
                        ? 'bg-blue-500 text-white'
                        : 'bg-neutral-800 text-white'
                    }`}
                  >
                    {contact.type === 'community' && !isMe && (
                      <p className="text-xs text-neutral-400 mb-1">
                        {msg.sender.name || msg.sender.preferred_username}
                      </p>
                    )}
                    <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSend} className="p-4 border-t border-neutral-900">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="メッセージを入力..."
            className="flex-1 px-4 py-2 bg-neutral-900 border border-neutral-800 rounded-full text-white placeholder-neutral-500 focus:outline-none focus:border-blue-500"
          />
          <button
            type="submit"
            disabled={!input.trim() || sending}
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

export function DMPage({ actor }: DMPageProps) {
  const { contactId } = useParams<{ contactId?: string }>();
  const navigate = useNavigate();
  const [mutualFollowers, setMutualFollowers] = useState<DMContact[]>([]);
  const [communities, setCommunities] = useState<DMContact[]>([]);
  const [selectedContact, setSelectedContact] = useState<DMContact | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabType>('friends');
  const tabContainerRef = useRef<HTMLDivElement>(null);

  // Touch handling for swipe
  const touchStartX = useRef<number>(0);
  const touchEndX = useRef<number>(0);

  const loadContacts = useCallback(async () => {
    try {
      const data = await fetchDMContacts();
      setMutualFollowers(data.mutual_followers);
      setCommunities(data.communities);

      // Select contact from URL param
      if (contactId) {
        const decodedId = decodeURIComponent(contactId);
        const allContacts = [...data.mutual_followers, ...data.communities];
        const contact = allContacts.find(c => c.ap_id === decodedId);
        setSelectedContact(contact || null);
      }
    } catch (e) {
      console.error('Failed to load contacts:', e);
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => {
    loadContacts();
  }, [loadContacts]);

  const handleSelectContact = (contact: DMContact) => {
    setSelectedContact(contact);
    navigate(`/dm/${encodeURIComponent(contact.ap_id)}`);
  };

  const handleBack = () => {
    setSelectedContact(null);
    navigate('/dm');
  };

  // Swipe handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    touchEndX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = () => {
    const diff = touchStartX.current - touchEndX.current;
    const threshold = 50;

    if (Math.abs(diff) > threshold) {
      if (diff > 0 && activeTab === 'friends') {
        setActiveTab('communities');
      } else if (diff < 0 && activeTab === 'communities') {
        setActiveTab('friends');
      }
    }
  };

  const showChat = selectedContact !== null;

  // Get current tab's contacts
  const currentContacts = activeTab === 'friends' ? mutualFollowers : communities;

  return (
    <div className="flex flex-col h-full">
      {/* Chat view */}
      {showChat ? (
        <Chat contact={selectedContact} actor={actor} onBack={handleBack} />
      ) : (
        <>
          {/* Header with tabs */}
          <header className="sticky top-0 bg-black/95 backdrop-blur-sm border-b border-neutral-900 z-10">
            <div className="px-4 py-3">
              <h1 className="text-xl font-bold text-center">メッセージ</h1>
            </div>

            {/* Tab bar */}
            <div className="relative flex">
              <button
                onClick={() => setActiveTab('friends')}
                className={`flex-1 py-3 text-center font-medium transition-colors ${
                  activeTab === 'friends' ? 'text-white' : 'text-neutral-500'
                }`}
              >
                友達
              </button>
              <button
                onClick={() => setActiveTab('communities')}
                className={`flex-1 py-3 text-center font-medium transition-colors ${
                  activeTab === 'communities' ? 'text-white' : 'text-neutral-500'
                }`}
              >
                コミュニティ
              </button>
              {/* Tab indicator */}
              <div
                className="absolute bottom-0 h-0.5 bg-white transition-transform duration-200"
                style={{
                  width: '50%',
                  transform: `translateX(${activeTab === 'friends' ? '0%' : '100%'})`,
                }}
              />
            </div>
          </header>

          {/* Swipeable content area */}
          <div
            ref={tabContainerRef}
            className="flex-1 overflow-y-auto"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            {loading ? (
              <div className="p-8 text-center text-neutral-500">Loading...</div>
            ) : currentContacts.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center min-h-[50vh]">
                <div className="w-20 h-20 mb-4 rounded-full bg-neutral-800 flex items-center justify-center">
                  {activeTab === 'friends' ? (
                    <svg className="w-10 h-10 text-neutral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                  ) : (
                    <svg className="w-10 h-10 text-neutral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                  )}
                </div>
                <p className="text-neutral-400 mb-2 text-lg font-medium">
                  {activeTab === 'friends' ? '友達がいません' : 'コミュニティがありません'}
                </p>
                <p className="text-neutral-500 text-sm">
                  {activeTab === 'friends'
                    ? '相互フォローしているユーザーが\nここに表示されます'
                    : '参加しているコミュニティが\nここに表示されます'
                  }
                </p>
              </div>
            ) : (
              <div className="divide-y divide-neutral-900">
                {currentContacts.map((contact) => (
                  <ContactItem
                    key={contact.ap_id}
                    contact={contact}
                    onClick={() => handleSelectContact(contact)}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
