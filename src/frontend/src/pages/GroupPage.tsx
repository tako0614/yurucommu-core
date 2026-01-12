import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { GroupWithMembership, Room, Message, Member } from '../types';
import { fetchGroups, fetchRooms, fetchMessages, sendMessage } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { UserAvatar } from '../components/UserAvatar';

interface GroupPageProps {
  currentMember: Member;
}

export function GroupPage({ currentMember }: GroupPageProps) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { groupId, roomId } = useParams<{ groupId?: string; roomId?: string }>();

  const [groups, setGroups] = useState<GroupWithMembership[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [messageInput, setMessageInput] = useState('');
  const [sending, setSending] = useState(false);

  const selectedGroup = groups.find(g => g.id === groupId);
  const selectedRoom = rooms.find(r => r.id === roomId);

  // Load groups
  useEffect(() => {
    fetchGroups()
      .then(data => setGroups(data.groups || []))
      .catch(e => console.error('Failed to load groups:', e))
      .finally(() => setLoading(false));
  }, []);

  // Load rooms when group is selected
  useEffect(() => {
    if (!groupId) {
      setRooms([]);
      return;
    }
    fetchRooms(groupId)
      .then(data => setRooms(data.rooms || []))
      .catch(e => console.error('Failed to load rooms:', e));
  }, [groupId]);

  // Load messages when room is selected
  const loadMessages = useCallback(async () => {
    if (!roomId) {
      setMessages([]);
      return;
    }
    try {
      const data = await fetchMessages(roomId, { limit: 50 });
      setMessages(data.messages || []);
    } catch (e) {
      console.error('Failed to load messages:', e);
    }
  }, [roomId]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  const handleSendMessage = async () => {
    if (!roomId || !messageInput.trim() || sending) return;
    setSending(true);
    try {
      const newMessage = await sendMessage(roomId, { content: messageInput.trim() });
      setMessages(prev => [...prev, newMessage]);
      setMessageInput('');
    } catch (e) {
      console.error('Failed to send message:', e);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Show group list
  if (!groupId) {
    return (
      <div className="flex flex-col h-full">
        <header className="sticky top-0 bg-black/80 backdrop-blur-sm border-b border-neutral-900 z-10">
          <h1 className="text-xl font-bold px-4 py-3">{t('groups.title')}</h1>
        </header>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-8 text-center text-neutral-500">{t('common.loading')}</div>
          ) : groups.length === 0 ? (
            <div className="p-8 text-center text-neutral-500">{t('groups.noGroups')}</div>
          ) : (
            groups.map(group => (
              <Link
                key={group.id}
                to={`/groups/${group.id}`}
                className="flex items-center gap-3 px-4 py-3 border-b border-neutral-900 hover:bg-neutral-900/30 transition-colors"
              >
                <div className="w-12 h-12 rounded-lg bg-neutral-800 flex items-center justify-center text-xl">
                  {group.icon_url ? (
                    <img src={group.icon_url} alt="" className="w-full h-full rounded-lg object-cover" />
                  ) : (
                    group.name.charAt(0).toUpperCase()
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-white truncate">{group.name}</div>
                  <div className="text-sm text-neutral-500 truncate">
                    {group.member_count} {t('groups.members')} · {group.room_count} {t('groups.rooms')}
                  </div>
                </div>
              </Link>
            ))
          )}
        </div>
      </div>
    );
  }

  // Show room list
  if (!roomId) {
    return (
      <div className="flex flex-col h-full">
        <header className="sticky top-0 bg-black/80 backdrop-blur-sm border-b border-neutral-900 z-10">
          <div className="flex items-center gap-3 px-4 py-3">
            <button onClick={() => navigate('/')} className="text-neutral-400 hover:text-white">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h1 className="text-xl font-bold">{selectedGroup?.name || t('rooms.title')}</h1>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto">
          {rooms.length === 0 ? (
            <div className="p-8 text-center text-neutral-500">{t('rooms.noRooms')}</div>
          ) : (
            rooms.map(room => (
              <Link
                key={room.id}
                to={`/groups/${groupId}/rooms/${room.id}`}
                className="flex items-center gap-3 px-4 py-3 border-b border-neutral-900 hover:bg-neutral-900/30 transition-colors"
              >
                <div className="w-10 h-10 rounded-lg bg-neutral-800 flex items-center justify-center">
                  {room.kind === 'chat' ? (
                    <svg className="w-5 h-5 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-white truncate"># {room.name}</div>
                  <div className="text-sm text-neutral-500 truncate">
                    {room.kind === 'chat' ? t('rooms.chat') : t('rooms.forum')}
                  </div>
                </div>
              </Link>
            ))
          )}
        </div>
      </div>
    );
  }

  // Show chat room
  return (
    <div className="flex flex-col h-full">
      <header className="sticky top-0 bg-black/80 backdrop-blur-sm border-b border-neutral-900 z-10">
        <div className="flex items-center gap-3 px-4 py-3">
          <button onClick={() => navigate(`/groups/${groupId}`)} className="text-neutral-400 hover:text-white">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-xl font-bold"># {selectedRoom?.name}</h1>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="text-center text-neutral-500 py-8">{t('messages.noMessages')}</div>
        ) : (
          messages.map(message => (
            <div key={message.id} className="flex gap-3">
              <UserAvatar
                avatarUrl={message.avatar_url}
                name={message.display_name || message.username}
                size={40}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="font-bold text-white">{message.display_name || message.username}</span>
                  <span className="text-xs text-neutral-500">{formatTime(message.created_at)}</span>
                </div>
                <p className="text-[15px] text-neutral-200 whitespace-pre-wrap break-words">{message.content}</p>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Input */}
      <div className="border-t border-neutral-900 p-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={messageInput}
            onChange={e => setMessageInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('messages.placeholder')}
            className="flex-1 bg-neutral-900 text-white placeholder-neutral-500 rounded-full px-4 py-2 outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={handleSendMessage}
            disabled={!messageInput.trim() || sending}
            className="px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-neutral-800 disabled:text-neutral-600 rounded-full font-medium transition-colors"
          >
            {t('messages.send')}
          </button>
        </div>
      </div>
    </div>
  );
}
