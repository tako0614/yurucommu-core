import { useState, useRef, useEffect, useCallback } from 'react';
import { Message, Member } from '../types';
import { UserAvatar } from './UserAvatar';

interface MessageListProps {
  messages: Message[];
  currentMember: Member;
  loadingMore: boolean;
  onLoadMore: () => void;
  onReply: (message: Message) => void;
  onEdit: (message: Message, content: string) => void;
  onDelete: (message: Message) => void;
}

export function MessageList({
  messages,
  currentMember,
  loadingMore,
  onLoadMore,
  onReply,
  onEdit,
  onDelete,
}: MessageListProps) {
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [editContent, setEditContent] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const prevMessagesLengthRef = useRef(0);

  useEffect(() => {
    if (messages.length > prevMessagesLengthRef.current) {
      const lastMsg = messages[messages.length - 1];
      const prevLastMsg = prevMessagesLengthRef.current > 0 ? messages[prevMessagesLengthRef.current - 1] : null;
      if (!prevLastMsg || lastMsg.created_at > prevLastMsg.created_at) {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
    }
    prevMessagesLengthRef.current = messages.length;
  }, [messages]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const target = e.target as HTMLDivElement;
    if (target.scrollTop < 100 && !loadingMore) {
      onLoadMore();
    }
  }, [loadingMore, onLoadMore]);

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getReplyMessage = (replyToId: string | null) => {
    if (!replyToId) return null;
    return messages.find(m => m.id === replyToId);
  };

  const canEdit = (msg: Message) => currentMember.id === msg.member_id;
  const canDelete = (msg: Message) => {
    if (currentMember.id === msg.member_id) return true;
    if (currentMember.role === 'owner' || currentMember.role === 'moderator') return true;
    return false;
  };

  const startEdit = (msg: Message) => {
    setEditingMessage(msg);
    setEditContent(msg.content);
  };

  const cancelEdit = () => {
    setEditingMessage(null);
    setEditContent('');
  };

  const saveEdit = () => {
    if (!editingMessage) return;
    onEdit(editingMessage, editContent);
    cancelEdit();
  };

  const handleDelete = (msg: Message) => {
    if (confirm('このメッセージを削除しますか？')) {
      onDelete(msg);
    }
  };

  if (messages.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto p-4 flex flex-col items-center justify-center text-neutral-500">
        <p>メッセージがありません</p>
        <p className="mt-2">最初のメッセージを送ってみましょう</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4" ref={containerRef} onScroll={handleScroll}>
      {loadingMore && (
        <div className="text-center py-4 text-neutral-500 text-sm">読み込み中...</div>
      )}
      {messages.map(msg => {
        const replyMsg = getReplyMessage(msg.reply_to_id);
        const isEditing = editingMessage?.id === msg.id;

        return (
          <div key={msg.id} className="group flex gap-3 mb-4 p-2 rounded-md hover:bg-neutral-900">
            <UserAvatar avatarUrl={msg.avatar_url} name={msg.display_name || msg.username} size="large" />
            <div className="flex-1 min-w-0">
              {/* Reply indicator */}
              {replyMsg && (
                <div className="flex items-center gap-2 text-sm text-neutral-500 px-2 py-1 mb-1 bg-neutral-900 border-l-2 border-blue-600 rounded-r">
                  <span className="text-blue-500">↩</span>
                  <span className="font-medium text-neutral-400">{replyMsg.display_name || replyMsg.username}</span>
                  <span className="text-neutral-600 overflow-hidden text-ellipsis whitespace-nowrap">
                    {replyMsg.content.length > 50 ? replyMsg.content.slice(0, 50) + '...' : replyMsg.content}
                  </span>
                </div>
              )}
              <div className="flex items-baseline gap-2 mb-1">
                <span className="font-semibold text-neutral-100">{msg.display_name || msg.username}</span>
                <span className="text-xs text-neutral-600">{formatTime(msg.created_at)}</span>
              </div>
              {isEditing ? (
                <div className="flex flex-col gap-2 mt-1">
                  <textarea
                    className="bg-neutral-800 border border-neutral-600 rounded-md p-2 text-neutral-100 text-sm resize-none min-h-[60px] focus:outline-none focus:border-blue-600"
                    value={editContent}
                    onChange={e => setEditContent(e.target.value)}
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <button
                      className="px-3 py-1.5 rounded text-sm cursor-pointer bg-blue-600 text-white hover:bg-blue-700"
                      onClick={saveEdit}
                    >
                      保存
                    </button>
                    <button
                      className="px-3 py-1.5 rounded text-sm cursor-pointer bg-neutral-700 text-neutral-100 hover:bg-neutral-600"
                      onClick={cancelEdit}
                    >
                      キャンセル
                    </button>
                  </div>
                </div>
              ) : (
                msg.content && (
                  <div className="leading-relaxed break-words whitespace-pre-wrap text-neutral-200">
                    {msg.content}
                  </div>
                )
              )}
              {msg.attachments && msg.attachments.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {msg.attachments.map(att => (
                    <a
                      key={att.id}
                      href={`/media/${att.r2_key}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block"
                    >
                      {att.content_type.startsWith('image/') ? (
                        <img
                          src={`/media/${att.r2_key}`}
                          alt={att.filename}
                          className="max-w-[300px] max-h-[200px] rounded-lg object-cover"
                        />
                      ) : (
                        <div className="flex items-center gap-2 px-4 py-2 bg-neutral-800 rounded-md text-sm">
                          <span className="text-lg">📎</span>
                          <span className="text-neutral-100">{att.filename}</span>
                          <span className="text-neutral-600 text-xs">{formatFileSize(att.size)}</span>
                        </div>
                      )}
                    </a>
                  ))}
                </div>
              )}
            </div>
            {/* Message actions */}
            {!isEditing && (
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  className="bg-transparent border-none text-neutral-600 cursor-pointer p-1.5 text-sm rounded hover:bg-neutral-800 hover:text-neutral-100"
                  onClick={() => onReply(msg)}
                  title="返信"
                >
                  ↩
                </button>
                {canEdit(msg) && (
                  <button
                    className="bg-transparent border-none text-neutral-600 cursor-pointer p-1.5 text-sm rounded hover:bg-neutral-800 hover:text-neutral-100"
                    onClick={() => startEdit(msg)}
                    title="編集"
                  >
                    ✏️
                  </button>
                )}
                {canDelete(msg) && (
                  <button
                    className="bg-transparent border-none text-neutral-600 cursor-pointer p-1.5 text-sm rounded hover:bg-red-950 hover:text-red-500"
                    onClick={() => handleDelete(msg)}
                    title="削除"
                  >
                    🗑️
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
      <div ref={messagesEndRef} />
    </div>
  );
}
