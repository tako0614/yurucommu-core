import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Actor } from '../types';
import {
  fetchDMContacts,
  DMContact,
  fetchDMRequests,
  DMRequest,
  acceptDMRequest,
  rejectDMRequest,
} from '../lib/api';
import { useI18n } from '../lib/i18n';
import { DMChatPanel } from '../components/dm/DMChatPanel';
import { DMContactItem } from '../components/dm/DMContactItem';

interface DMPageProps {
  actor: Actor;
}

type TabType = 'all' | 'friends' | 'communities' | 'requests';

export function DMPage({ actor }: DMPageProps) {
  const { contactId } = useParams<{ contactId?: string }>();
  const navigate = useNavigate();
  const [contacts, setContacts] = useState<DMContact[]>([]);
  const [communities, setCommunities] = useState<DMContact[]>([]);
  const [requests, setRequests] = useState<DMRequest[]>([]);
  const [requestCount, setRequestCount] = useState(0);
  const [selectedContact, setSelectedContact] = useState<DMContact | null>(null);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const tabContainerRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();

  // Touch handling for swipe
  const touchStartX = useRef<number>(0);
  const touchEndX = useRef<number>(0);

  const loadContacts = useCallback(async () => {
    setListError(null);
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
      setListError(t('common.error'));
    } finally {
      setLoading(false);
    }
  }, [contactId, t]);

  const loadRequests = useCallback(async () => {
    setListError(null);
    try {
      const data = await fetchDMRequests();
      setRequests(data);
    } catch (e) {
      console.error('Failed to load requests:', e);
      setListError(t('common.error'));
    }
  }, [t]);

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
      setListError(t('common.error'));
    }
  };

  const handleRejectRequest = async (senderApId: string) => {
    try {
      await rejectDMRequest(senderApId);
      setRequests(prev => prev.filter(r => r.sender.ap_id !== senderApId));
      setRequestCount(prev => Math.max(0, prev - 1));
    } catch (e) {
      console.error('Failed to reject request:', e);
      setListError(t('common.error'));
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
        <DMChatPanel
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
              <h1 className="text-xl font-bold text-white">繝医・繧ｯ</h1>
              <div className="flex items-center gap-2">
                {/* Search icon */}
                <button aria-label="Search" className="p-2 text-neutral-400 hover:text-white transition-colors">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </button>
                {/* New chat icon */}
                <button aria-label="New chat" className="p-2 text-neutral-400 hover:text-white transition-colors">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                </button>
                {/* More icon */}
                <button aria-label="More options" className="p-2 text-neutral-400 hover:text-white transition-colors">
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
                  placeholder="讀懃ｴ｢"
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
                縺吶∋縺ｦ
              </button>
              <button
                onClick={() => setActiveTab('friends')}
                className={`px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors ${
                  activeTab === 'friends' ? 'text-white' : 'text-neutral-500'
                }`}
              >
                蜿九□縺｡
              </button>
              <button
                onClick={() => setActiveTab('communities')}
                className={`px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors ${
                  activeTab === 'communities' ? 'text-white' : 'text-neutral-500'
                }`}
              >
                繧ｰ繝ｫ繝ｼ繝・
              </button>
              <button
                onClick={() => setActiveTab('requests')}
                className={`px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors relative ${
                  activeTab === 'requests' ? 'text-white' : 'text-neutral-500'
                }`}
              >
                繝ｪ繧ｯ繧ｨ繧ｹ繝・
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
            {listError && (
              <div className="px-4 py-2 text-sm text-red-400 bg-red-500/10">
                {listError}
              </div>
            )}
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
                  <p className="text-neutral-400 mb-2 text-lg font-medium">繝ｪ繧ｯ繧ｨ繧ｹ繝医′縺ゅｊ縺ｾ縺帙ｓ</p>
                  <p className="text-neutral-500 text-sm">
                    譁ｰ縺励＞繝｡繝・そ繝ｼ繧ｸ繝ｪ繧ｯ繧ｨ繧ｹ繝医′<br />縺薙％縺ｫ陦ｨ遉ｺ縺輔ｌ縺ｾ縺・
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
                  {searchQuery ? '讀懃ｴ｢邨先棡縺後≠繧翫∪縺帙ｓ' : activeTab === 'all' ? '繝医・繧ｯ縺後≠繧翫∪縺帙ｓ' : activeTab === 'friends' ? '蜿九□縺｡縺後＞縺ｾ縺帙ｓ' : '繧ｰ繝ｫ繝ｼ繝励′縺ゅｊ縺ｾ縺帙ｓ'}
                </p>
                <p className="text-neutral-500 text-sm">
                  {searchQuery
                    ? '蛻･縺ｮ繧ｭ繝ｼ繝ｯ繝ｼ繝峨〒讀懃ｴ｢縺励※縺上□縺輔＞'
                    : activeTab === 'all'
                    ? '蜿九□縺｡繧・げ繝ｫ繝ｼ繝励→縺ｮ\n繝医・繧ｯ縺後％縺薙↓陦ｨ遉ｺ縺輔ｌ縺ｾ縺・
                    : activeTab === 'friends'
                    ? '逶ｸ莠偵ヵ繧ｩ繝ｭ繝ｼ縺励※縺・ｋ繝ｦ繝ｼ繧ｶ繝ｼ縺圭n縺薙％縺ｫ陦ｨ遉ｺ縺輔ｌ縺ｾ縺・
                    : '蜿ょ刈縺励※縺・ｋ繧ｳ繝溘Η繝九ユ繧｣縺圭n縺薙％縺ｫ陦ｨ遉ｺ縺輔ｌ縺ｾ縺・
                  }
                </p>
              </div>
            ) : (
              // Contact list
              <div className="divide-y divide-neutral-900">
                {currentContacts.map((contact) => (
                  <DMContactItem
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


