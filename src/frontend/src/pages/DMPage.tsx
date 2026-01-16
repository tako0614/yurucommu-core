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
  fetchDMRequests,
  DMRequest,
  acceptDMRequest,
  rejectDMRequest,
  fetchUserDMTyping,
  sendUserDMTyping,
  markDMAsRead,
} from '../lib/api';

interface DMPageProps {
  actor: Actor;
}

type TabType = 'all' | 'friends' | 'communities' | 'requests';

// Format time for display (LINE style)
function formatMessageTime(dateString: string | null): string {
  if (!dateString) return '';
  const date = new Date(dateString);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const oneDay = 24 * 60 * 60 * 1000;
  const oneWeek = 7 * oneDay;
  const oneYear = 365 * oneDay;

  if (diff < oneDay && date.getDate() === now.getDate()) {
    // Today - show time only
    return date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  } else if (diff < oneWeek) {
    // This week - show day name
    const days = ['日', '月', '火', '水', '木', '金', '土'];
    return days[date.getDay()];
  } else if (diff < oneYear) {
    // This year - show month/day
    return `${date.getMonth() + 1}/${date.getDate()}`;
  } else {
    // Older - show year/month/day
    return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
  }
}

// Contact item in the list (LINE style)
function ContactItem({
  contact,
  onClick,
  isPinned = false,
  unreadCount = 0,
}: {
  contact: DMContact;
  onClick: () => void;
  isPinned?: boolean;
  unreadCount?: number;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-neutral-900 active:bg-neutral-800 transition-colors"
    >
      {/* Avatar */}
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
        {/* Pin badge */}
        {isPinned && (
          <div className="absolute -top-1 -left-1 w-5 h-5 bg-green-500 rounded-full flex items-center justify-center border-2 border-black">
            <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M16,12V4H17V2H7V4H8V12L6,14V16H11.2V22H12.8V16H18V14L16,12Z" />
            </svg>
          </div>
        )}
        {/* Community badge */}
        {contact.type === 'community' && (
          <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center border-2 border-black">
            <svg className="w-3.5 h-3.5 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
            </svg>
          </div>
        )}
      </div>

      {/* Content */}
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
            {contact.type === 'community' ? 'グループチャット' : 'メッセージを送信'}
          </p>
        )}
      </div>

      {/* Time and unread badge */}
      <div className="flex flex-col items-end gap-1 flex-shrink-0">
        <span className="text-xs text-neutral-500">
          {formatMessageTime(contact.last_message_at)}
        </span>
        {unreadCount > 0 && (
          <span className="min-w-[20px] h-5 px-1.5 bg-green-500 rounded-full text-xs flex items-center justify-center text-white font-bold">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </div>
    </button>
  );
}

// Request item
function RequestItem({
  request,
  onAccept,
  onReject,
}: {
  request: DMRequest;
  onAccept: () => void;
  onReject: () => void;
}) {
  const [processing, setProcessing] = useState(false);

  const handleAccept = async () => {
    setProcessing(true);
    try {
      await onAccept();
    } finally {
      setProcessing(false);
    }
  };

  const handleReject = async () => {
    setProcessing(true);
    try {
      await onReject();
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="px-4 py-4 border-b border-neutral-900">
      <div className="flex items-start gap-3">
        {request.sender.icon_url ? (
          <img
            src={request.sender.icon_url}
            alt={request.sender.name || request.sender.preferred_username}
            className="w-12 h-12 rounded-full object-cover flex-shrink-0"
          />
        ) : (
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white font-bold flex-shrink-0">
            {(request.sender.name || request.sender.preferred_username)?.[0]?.toUpperCase() || '?'}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-white">
            {request.sender.name || request.sender.preferred_username}
          </div>
          <div className="text-sm text-neutral-500">@{request.sender.preferred_username}</div>
          <div className="mt-2 p-3 bg-neutral-900 rounded-lg">
            <p className="text-sm text-neutral-300 whitespace-pre-wrap">{request.content}</p>
          </div>
          <div className="flex gap-2 mt-3">
            <button
              onClick={handleAccept}
              disabled={processing}
              className="flex-1 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-neutral-700 text-white rounded-full font-medium text-sm transition-colors"
            >
              承認
            </button>
            <button
              onClick={handleReject}
              disabled={processing}
              className="flex-1 py-2 bg-neutral-800 hover:bg-neutral-700 disabled:bg-neutral-900 text-white rounded-full font-medium text-sm transition-colors"
            >
              拒否
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Chat component for both users and communities
function Chat({
  contact,
  actor,
  onBack,
  onRead,
}: {
  contact: DMContact;
  actor: Actor;
  onBack: () => void;
  onRead?: () => void;
}) {
  const [messages, setMessages] = useState<(DMMessage | CommunityMessage)[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastTypingSentRef = useRef(0);

  const loadMessages = useCallback(async () => {
    try {
      if (contact.type === 'community') {
        const data = await fetchCommunityMessages(contact.ap_id);
        setMessages(data);
      } else {
        const { messages } = await fetchUserDMMessages(contact.ap_id);
        setMessages(messages);
        // Mark as read when messages are loaded
        try {
          await markDMAsRead(contact.ap_id);
          onRead?.();
        } catch (e) {
          // Ignore read marking errors
        }
      }
    } catch (e) {
      console.error('Failed to load messages:', e);
    } finally {
      setLoading(false);
    }
  }, [contact.ap_id, contact.type, onRead]);

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
      } catch (e) {
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
          {contact.type === 'community' ? (
            <p className="text-xs text-neutral-500">{contact.member_count}人のメンバー</p>
          ) : isTyping ? (
            <p className="text-xs text-neutral-500">Typing...</p>
          ) : null}
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
            onChange={handleInputChange}
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
  const [contacts, setContacts] = useState<DMContact[]>([]);
  const [communities, setCommunities] = useState<DMContact[]>([]);
  const [requests, setRequests] = useState<DMRequest[]>([]);
  const [requestCount, setRequestCount] = useState(0);
  const [selectedContact, setSelectedContact] = useState<DMContact | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabType>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const tabContainerRef = useRef<HTMLDivElement>(null);

  // Touch handling for swipe
  const touchStartX = useRef<number>(0);
  const touchEndX = useRef<number>(0);

  const loadContacts = useCallback(async () => {
    try {
      const data = await fetchDMContacts();
      setContacts(data.mutual_followers);
      setCommunities(data.communities);
      setRequestCount(data.request_count);

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

  const loadRequests = useCallback(async () => {
    try {
      const data = await fetchDMRequests();
      setRequests(data);
    } catch (e) {
      console.error('Failed to load requests:', e);
    }
  }, []);

  useEffect(() => {
    loadContacts();
  }, [loadContacts]);

  useEffect(() => {
    if (activeTab === 'requests') {
      loadRequests();
    }
  }, [activeTab, loadRequests]);

  const handleSelectContact = (contact: DMContact) => {
    setSelectedContact(contact);
    navigate(`/dm/${encodeURIComponent(contact.ap_id)}`);
  };

  const handleBack = () => {
    setSelectedContact(null);
    navigate('/dm');
  };

  const handleAcceptRequest = async (senderApId: string) => {
    try {
      await acceptDMRequest(senderApId);
      setRequests(prev => prev.filter(r => r.sender.ap_id !== senderApId));
      setRequestCount(prev => Math.max(0, prev - 1));
      loadContacts(); // Reload contacts to show new contact
    } catch (e) {
      console.error('Failed to accept request:', e);
    }
  };

  const handleRejectRequest = async (senderApId: string) => {
    try {
      await rejectDMRequest(senderApId);
      setRequests(prev => prev.filter(r => r.sender.ap_id !== senderApId));
      setRequestCount(prev => Math.max(0, prev - 1));
    } catch (e) {
      console.error('Failed to reject request:', e);
    }
  };

  // Swipe handlers
  const tabs: TabType[] = ['all', 'friends', 'communities', 'requests'];
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    touchEndX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = () => {
    const diff = touchStartX.current - touchEndX.current;
    const threshold = 50;
    const currentIndex = tabs.indexOf(activeTab);

    if (Math.abs(diff) > threshold) {
      if (diff > 0 && currentIndex < tabs.length - 1) {
        setActiveTab(tabs[currentIndex + 1]);
      } else if (diff < 0 && currentIndex > 0) {
        setActiveTab(tabs[currentIndex - 1]);
      }
    }
  };

  const showChat = selectedContact !== null;

  // Get current tab's content with search filter
  const getCurrentContent = () => {
    let result: DMContact[] = [];
    switch (activeTab) {
      case 'all':
        result = [...contacts, ...communities].sort((a, b) => {
          const aTime = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
          const bTime = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
          return bTime - aTime;
        });
        break;
      case 'friends':
        result = contacts;
        break;
      case 'communities':
        result = communities;
        break;
      default:
        result = [];
    }

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(c =>
        (c.name?.toLowerCase().includes(query)) ||
        c.preferred_username.toLowerCase().includes(query)
      );
    }

    return result;
  };

  const currentContacts = getCurrentContent();
  const tabIndex = tabs.indexOf(activeTab);

  return (
    <div className="flex flex-col h-full">
      {/* Chat view */}
      {showChat ? (
        <Chat
          contact={selectedContact}
          actor={actor}
          onBack={handleBack}
          onRead={() => {
            // Clear unread count locally for this contact
            if (selectedContact.type === 'user') {
              setContacts(prev => prev.map(c =>
                c.ap_id === selectedContact.ap_id ? { ...c, unread_count: 0 } : c
              ));
            }
          }}
        />
      ) : (
        <>
          {/* Header - LINE style */}
          <header className="sticky top-0 bg-black/95 backdrop-blur-sm z-10">
            {/* Title bar with icons */}
            <div className="flex items-center justify-between px-4 py-3">
              <h1 className="text-xl font-bold text-white">トーク</h1>
              <div className="flex items-center gap-2">
                {/* Search icon */}
                <button className="p-2 text-neutral-400 hover:text-white transition-colors">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </button>
                {/* New chat icon */}
                <button className="p-2 text-neutral-400 hover:text-white transition-colors">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                </button>
                {/* More icon */}
                <button className="p-2 text-neutral-400 hover:text-white transition-colors">
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Search bar */}
            <div className="px-4 pb-3">
              <div className="relative">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-neutral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="検索"
                  className="w-full pl-10 pr-4 py-2 bg-neutral-900 rounded-lg text-white placeholder-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-700"
                />
              </div>
            </div>

            {/* Tab bar - LINE style with underline on active */}
            <div className="relative flex overflow-x-auto scrollbar-hide border-b border-neutral-900">
              <button
                onClick={() => setActiveTab('all')}
                className={`px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors ${
                  activeTab === 'all' ? 'text-white' : 'text-neutral-500'
                }`}
              >
                すべて
              </button>
              <button
                onClick={() => setActiveTab('friends')}
                className={`px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors ${
                  activeTab === 'friends' ? 'text-white' : 'text-neutral-500'
                }`}
              >
                友だち
              </button>
              <button
                onClick={() => setActiveTab('communities')}
                className={`px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors ${
                  activeTab === 'communities' ? 'text-white' : 'text-neutral-500'
                }`}
              >
                グループ
              </button>
              <button
                onClick={() => setActiveTab('requests')}
                className={`px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors relative ${
                  activeTab === 'requests' ? 'text-white' : 'text-neutral-500'
                }`}
              >
                リクエスト
                {requestCount > 0 && (
                  <span className="absolute top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-green-500 rounded-full text-[10px] flex items-center justify-center text-white font-bold">
                    {requestCount > 99 ? '99+' : requestCount}
                  </span>
                )}
              </button>
              {/* Tab indicator - underline style */}
              <div
                className="absolute bottom-0 h-0.5 bg-green-500 transition-all duration-200"
                style={{
                  width: tabIndex === 0 ? '52px' : tabIndex === 1 ? '52px' : tabIndex === 2 ? '64px' : '72px',
                  left: tabIndex === 0 ? '0px' : tabIndex === 1 ? '68px' : tabIndex === 2 ? '136px' : '216px',
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
            ) : activeTab === 'requests' ? (
              // Requests tab
              requests.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center min-h-[50vh]">
                  <div className="w-20 h-20 mb-4 rounded-full bg-neutral-800 flex items-center justify-center">
                    <svg className="w-10 h-10 text-neutral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <p className="text-neutral-400 mb-2 text-lg font-medium">リクエストがありません</p>
                  <p className="text-neutral-500 text-sm">
                    新しいメッセージリクエストが<br />ここに表示されます
                  </p>
                </div>
              ) : (
                <div>
                  {requests.map((request) => (
                    <RequestItem
                      key={request.id}
                      request={request}
                      onAccept={() => handleAcceptRequest(request.sender.ap_id)}
                      onReject={() => handleRejectRequest(request.sender.ap_id)}
                    />
                  ))}
                </div>
              )
            ) : currentContacts.length === 0 ? (
              // Empty state for all/friends/communities
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center min-h-[50vh]">
                <div className="w-20 h-20 mb-4 rounded-full bg-neutral-800 flex items-center justify-center">
                  <svg className="w-10 h-10 text-neutral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                </div>
                <p className="text-neutral-400 mb-2 text-lg font-medium">
                  {searchQuery ? '検索結果がありません' : activeTab === 'all' ? 'トークがありません' : activeTab === 'friends' ? '友だちがいません' : 'グループがありません'}
                </p>
                <p className="text-neutral-500 text-sm">
                  {searchQuery
                    ? '別のキーワードで検索してください'
                    : activeTab === 'all'
                    ? '友だちやグループとの\nトークがここに表示されます'
                    : activeTab === 'friends'
                    ? '相互フォローしているユーザーが\nここに表示されます'
                    : '参加しているコミュニティが\nここに表示されます'
                  }
                </p>
              </div>
            ) : (
              // Contact list
              <div className="divide-y divide-neutral-900">
                {currentContacts.map((contact) => (
                  <ContactItem
                    key={contact.ap_id}
                    contact={contact}
                    onClick={() => handleSelectContact(contact)}
                    unreadCount={contact.unread_count || 0}
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
