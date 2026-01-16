import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { DMConversation, Actor } from '../types';
import { fetchDMConversations, createDMConversation } from '../lib/api';
import { DMList } from '../components/DMList';
import { DMChat } from '../components/DMChat';
import { NewConversationModal } from '../components/NewConversationModal';

interface DMPageProps {
  actor: Actor;
}

const NewMessageIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
  </svg>
);

export function DMPage({ actor }: DMPageProps) {
  const { conversationId } = useParams<{ conversationId?: string }>();
  const navigate = useNavigate();
  const [conversations, setConversations] = useState<DMConversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<DMConversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [showNewModal, setShowNewModal] = useState(false);

  const loadConversations = useCallback(async () => {
    try {
      const data = await fetchDMConversations();
      setConversations(data);

      // Select conversation from URL param
      if (conversationId) {
        const conv = data.find(c => c.id === conversationId);
        setSelectedConversation(conv || null);
      }
    } catch (e) {
      console.error('Failed to load conversations:', e);
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  const handleSelectConversation = (conv: DMConversation) => {
    setSelectedConversation(conv);
    navigate(`/dm/${conv.id}`);
  };

  const handleBack = () => {
    setSelectedConversation(null);
    navigate('/dm');
  };

  const handleNewConversation = async (selectedActor: Actor) => {
    try {
      // Check if conversation already exists
      const existing = conversations.find(c => c.other_participant.ap_id === selectedActor.ap_id);
      if (existing) {
        handleSelectConversation(existing);
        return;
      }

      // Create new conversation
      const conv = await createDMConversation(selectedActor.ap_id);
      setConversations(prev => [conv, ...prev]);
      handleSelectConversation(conv);
    } catch (e) {
      console.error('Failed to create conversation:', e);
    }
  };

  // Mobile: show chat when conversation selected
  const showChat = selectedConversation !== null;

  return (
    <div className="flex h-full">
      {/* Conversation List - hide on mobile when chat is open */}
      <div className={`${showChat ? 'hidden md:flex' : 'flex'} flex-col w-full md:w-80 border-r border-neutral-900`}>
        <header className="sticky top-0 bg-black/80 backdrop-blur-sm border-b border-neutral-900 z-10">
          <div className="flex items-center justify-between px-4 py-3">
            <h1 className="text-xl font-bold">メッセージ</h1>
            <button
              onClick={() => setShowNewModal(true)}
              className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-full transition-colors"
            >
              <NewMessageIcon />
            </button>
          </div>
        </header>

        {loading ? (
          <div className="p-8 text-center text-neutral-500">Loading...</div>
        ) : conversations.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <div className="w-16 h-16 mb-4 rounded-full bg-neutral-800 flex items-center justify-center">
              <svg className="w-8 h-8 text-neutral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <p className="text-neutral-400 mb-4">メッセージはありません</p>
            <button
              onClick={() => setShowNewModal(true)}
              className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-full font-medium transition-colors"
            >
              メッセージを送る
            </button>
          </div>
        ) : (
          <DMList
            conversations={conversations}
            selectedId={selectedConversation?.id || null}
            onSelect={handleSelectConversation}
          />
        )}
      </div>

      {/* Chat Area */}
      <div className={`${showChat ? 'flex' : 'hidden md:flex'} flex-1 flex-col`}>
        {selectedConversation ? (
          <>
            {/* Mobile back button */}
            <div className="md:hidden flex items-center gap-3 px-4 py-3 border-b border-neutral-900 bg-black/80 backdrop-blur-sm">
              <button onClick={handleBack} className="text-neutral-400 hover:text-white transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <span className="font-bold text-white">
                {selectedConversation.other_participant.name || selectedConversation.other_participant.preferred_username}
              </span>
            </div>
            <DMChat conversation={selectedConversation} actor={actor} />
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-neutral-500">
            <div className="w-20 h-20 mb-4 rounded-full bg-neutral-800 flex items-center justify-center">
              <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <p className="text-lg font-medium mb-2">メッセージ</p>
            <p className="text-sm text-neutral-600 mb-4">フォロワーにプライベートメッセージを送信</p>
            <button
              onClick={() => setShowNewModal(true)}
              className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-full font-medium transition-colors"
            >
              メッセージを送る
            </button>
          </div>
        )}
      </div>

      {/* New Conversation Modal */}
      <NewConversationModal
        isOpen={showNewModal}
        onClose={() => setShowNewModal(false)}
        onSelect={handleNewConversation}
      />
    </div>
  );
}
