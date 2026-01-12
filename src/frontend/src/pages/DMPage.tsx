import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { DMConversation, Member } from '../types';
import { fetchDMConversations } from '../lib/api';
import { DMList } from '../components/DMList';
import { DMChat } from '../components/DMChat';

interface DMPageProps {
  currentMember: Member;
}

export function DMPage({ currentMember }: DMPageProps) {
  const { conversationId } = useParams<{ conversationId?: string }>();
  const navigate = useNavigate();
  const [conversations, setConversations] = useState<DMConversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<DMConversation | null>(null);
  const [loading, setLoading] = useState(true);

  const loadConversations = useCallback(async () => {
    try {
      const data = await fetchDMConversations();
      setConversations(data.conversations || []);

      // Select conversation from URL param
      if (conversationId) {
        const conv = data.conversations?.find(c => c.id === conversationId);
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

  // Mobile: show chat when conversation selected
  const showChat = selectedConversation !== null;

  return (
    <div className="flex h-full">
      {/* Conversation List - hide on mobile when chat is open */}
      <div className={`${showChat ? 'hidden md:flex' : 'flex'} flex-col w-full md:w-80 border-r border-neutral-900`}>
        <header className="sticky top-0 bg-black/80 backdrop-blur-sm border-b border-neutral-900 z-10">
          <h1 className="text-xl font-bold px-4 py-3">Messages</h1>
        </header>

        {loading ? (
          <div className="p-8 text-center text-neutral-500">Loading...</div>
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
                {selectedConversation.other_member.display_name || selectedConversation.other_member.username}
              </span>
            </div>
            <DMChat conversation={selectedConversation} currentMember={currentMember} />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-neutral-500">
            Select a conversation
          </div>
        )}
      </div>
    </div>
  );
}
