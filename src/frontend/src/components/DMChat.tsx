import { useState, useEffect, useRef, FormEvent } from 'react';
import { DMConversation, DMMessage, Actor } from '../types';
import { UserAvatar } from './UserAvatar';
import { fetchDMMessages, sendDMMessage } from '../lib/api';

interface DMChatProps {
  conversation: DMConversation;
  actor: Actor;
}

export function DMChat({ conversation, actor }: DMChatProps) {
  const [messages, setMessages] = useState<DMMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadMessages();
    const interval = setInterval(loadMessages, 3000);
    return () => clearInterval(interval);
  }, [conversation.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadMessages = async () => {
    try {
      const msgs = await fetchDMMessages(conversation.id);
      setMessages(msgs);
    } catch (e) {
      console.error('Failed to load DM messages:', e);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || submitting) return;

    setSubmitting(true);
    try {
      const msg = await sendDMMessage(conversation.id, newMessage.trim());
      setMessages((prev) => [...prev, msg]);
      setNewMessage('');
    } catch (e) {
      console.error('Failed to send DM:', e);
    } finally {
      setSubmitting(false);
    }
  };

  const formatTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString('ja-JP', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  // Group messages by date
  const groupedMessages: { date: string; messages: DMMessage[] }[] = [];
  let currentDate = '';
  messages.forEach((msg) => {
    const date = formatDate(msg.created_at);
    if (date !== currentDate) {
      currentDate = date;
      groupedMessages.push({ date, messages: [msg] });
    } else {
      groupedMessages[groupedMessages.length - 1].messages.push(msg);
    }
  });

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Header - hidden on mobile since DMPage shows it */}
      <div className="hidden md:flex px-4 py-3 border-b border-neutral-900 bg-black/80 backdrop-blur-sm items-center gap-3">
        <UserAvatar
          avatarUrl={conversation.other_participant.icon_url}
          name={conversation.other_participant.name || conversation.other_participant.preferred_username}
          size={40}
        />
        <div>
          <h3 className="font-bold text-white">
            {conversation.other_participant.name || conversation.other_participant.preferred_username}
          </h3>
          <p className="text-sm text-neutral-500">@{conversation.other_participant.username}</p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {groupedMessages.map((group) => (
          <div key={group.date}>
            <div className="flex items-center justify-center my-4">
              <span className="text-xs text-neutral-500 bg-neutral-900 px-3 py-1 rounded-full">
                {group.date}
              </span>
            </div>
            <div className="space-y-2">
              {group.messages.map((msg) => {
                const isMe = msg.sender.ap_id === actor.ap_id;
                return (
                  <div
                    key={msg.id}
                    className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[70%] px-4 py-2 rounded-2xl ${
                        isMe
                          ? 'bg-blue-500 text-white rounded-br-sm'
                          : 'bg-neutral-800 text-white rounded-bl-sm'
                      }`}
                    >
                      <p className="whitespace-pre-wrap break-words text-[15px]">{msg.content}</p>
                      <p
                        className={`text-xs mt-1 ${
                          isMe ? 'text-blue-200' : 'text-neutral-500'
                        }`}
                      >
                        {formatTime(msg.created_at)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-4 border-t border-neutral-900">
        <div className="flex gap-3">
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Start a new message"
            className="flex-1 bg-neutral-900 border border-neutral-800 rounded-full px-4 py-2.5 text-white placeholder-neutral-600 focus:outline-none focus:border-blue-500 transition-colors"
            disabled={submitting}
          />
          <button
            type="submit"
            disabled={!newMessage.trim() || submitting}
            className="bg-blue-500 text-white px-5 py-2 rounded-full font-bold text-sm hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
