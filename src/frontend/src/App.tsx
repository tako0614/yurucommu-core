import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

// Offline cache helpers
const CACHE_KEY_PREFIX = 'yurucommu_cache_';

function getCachedMessages(roomId: string): Message[] {
  try {
    const cached = localStorage.getItem(`${CACHE_KEY_PREFIX}messages_${roomId}`);
    return cached ? JSON.parse(cached) : [];
  } catch {
    return [];
  }
}

function setCachedMessages(roomId: string, messages: Message[]) {
  try {
    // Keep only last 100 messages in cache
    const toCache = messages.slice(-100);
    localStorage.setItem(`${CACHE_KEY_PREFIX}messages_${roomId}`, JSON.stringify(toCache));
  } catch {
    // Storage full, ignore
  }
}

function getCachedMember(): Member | null {
  try {
    const cached = localStorage.getItem(`${CACHE_KEY_PREFIX}member`);
    return cached ? JSON.parse(cached) : null;
  } catch {
    return null;
  }
}

function setCachedMember(member: Member | null) {
  try {
    if (member) {
      localStorage.setItem(`${CACHE_KEY_PREFIX}member`, JSON.stringify(member));
    } else {
      localStorage.removeItem(`${CACHE_KEY_PREFIX}member`);
    }
  } catch {
    // Storage full, ignore
  }
}

function getCachedRooms(): Room[] {
  try {
    const cached = localStorage.getItem(`${CACHE_KEY_PREFIX}rooms`);
    return cached ? JSON.parse(cached) : [];
  } catch {
    return [];
  }
}

function setCachedRooms(rooms: Room[]) {
  try {
    localStorage.setItem(`${CACHE_KEY_PREFIX}rooms`, JSON.stringify(rooms));
  } catch {
    // Storage full, ignore
  }
}

interface Member {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  role: 'owner' | 'moderator' | 'member';
}

interface Room {
  id: string;
  name: string;
  description: string | null;
  kind: string;
  posting_policy: string;
}

interface Attachment {
  id: string;
  r2_key: string;
  content_type: string;
  filename: string;
  size: number;
}

interface Message {
  id: string;
  room_id: string;
  member_id: string;
  content: string;
  created_at: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  attachments?: Attachment[];
  reply_to_id: string | null;
}

interface UploadedFile {
  r2_key: string;
  content_type: string;
  filename: string;
  size: number;
  preview?: string;
}

export default function App() {
  const [member, setMember] = useState<Member | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [showMembers, setShowMembers] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [editContent, setEditContent] = useState('');
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const pollIntervalRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Online/offline detection
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Check auth status (with offline support)
  useEffect(() => {
    // First, try to show cached member for instant load
    const cachedMember = getCachedMember();
    if (cachedMember) {
      setMember(cachedMember);
      setLoading(false);
    }

    // Then verify with server
    fetch('/api/me')
      .then(r => r.json())
      .then(data => {
        if (data.authenticated) {
          setMember(data.member);
          setCachedMember(data.member);
        } else {
          setMember(null);
          setCachedMember(null);
        }
      })
      .catch(() => {
        // Offline - keep using cached member if available
      })
      .finally(() => setLoading(false));
  }, []);

  // Load rooms (with offline support)
  useEffect(() => {
    // First, show cached rooms for instant load
    const cachedRooms = getCachedRooms();
    if (cachedRooms.length > 0) {
      setRooms(cachedRooms);
      if (!selectedRoom) {
        setSelectedRoom(cachedRooms[0]);
      }
    }

    // Then load from server
    fetch('/api/rooms')
      .then(r => r.json())
      .then(data => {
        const newRooms = data.rooms || [];
        setRooms(newRooms);
        setCachedRooms(newRooms);
        if (newRooms.length > 0 && !selectedRoom) {
          setSelectedRoom(newRooms[0]);
        }
      })
      .catch(() => {
        // Offline - keep using cached rooms
      });
  }, []);

  // Load members
  const loadMembers = useCallback(async () => {
    try {
      const res = await fetch('/api/members');
      const data = await res.json();
      setMembers(data.members || []);
    } catch (e) {
      console.error('Failed to load members:', e);
    }
  }, []);

  useEffect(() => {
    if (member) {
      loadMembers();
    }
  }, [member, loadMembers]);

  // Change member role (owner only)
  const changeRole = async (memberId: string, newRole: string) => {
    try {
      const res = await fetch(`/api/members/${memberId}/role`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      });
      if (res.ok) {
        loadMembers();
      }
    } catch (e) {
      console.error('Failed to change role:', e);
    }
  };

  // Remove member (owner/mod only)
  const removeMember = async (memberId: string) => {
    if (!confirm('このメンバーを削除しますか？')) return;
    try {
      const res = await fetch(`/api/members/${memberId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        loadMembers();
      }
    } catch (e) {
      console.error('Failed to remove member:', e);
    }
  };

  // Edit message (author only)
  const startEdit = (msg: Message) => {
    setEditingMessage(msg);
    setEditContent(msg.content);
  };

  const cancelEdit = () => {
    setEditingMessage(null);
    setEditContent('');
  };

  const saveEdit = async () => {
    if (!editingMessage || !selectedRoom) return;
    try {
      const res = await fetch(`/api/rooms/${selectedRoom.id}/messages/${editingMessage.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editContent }),
      });
      if (res.ok) {
        setMessages(prev =>
          prev.map(m => m.id === editingMessage.id ? { ...m, content: editContent } : m)
        );
        cancelEdit();
      }
    } catch (e) {
      console.error('Failed to edit message:', e);
    }
  };

  // Delete message (author/mod/owner)
  const deleteMessage = async (msg: Message) => {
    if (!confirm('このメッセージを削除しますか？')) return;
    if (!selectedRoom) return;
    try {
      const res = await fetch(`/api/rooms/${selectedRoom.id}/messages/${msg.id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setMessages(prev => prev.filter(m => m.id !== msg.id));
      }
    } catch (e) {
      console.error('Failed to delete message:', e);
    }
  };

  // Check if user can edit message (only author)
  const canEdit = (msg: Message) => {
    return member?.id === msg.member_id;
  };

  // Check if user can delete message (author, mod, owner)
  const canDelete = (msg: Message) => {
    if (!member) return false;
    if (member.id === msg.member_id) return true;
    if (member.role === 'owner' || member.role === 'moderator') return true;
    return false;
  };

  // Load messages for selected room (initial load with offline support)
  const loadMessages = useCallback(async () => {
    if (!selectedRoom) return;

    // First, show cached messages for instant load
    const cachedMsgs = getCachedMessages(selectedRoom.id);
    if (cachedMsgs.length > 0) {
      setMessages(cachedMsgs);
    }

    // Then load from server
    try {
      const res = await fetch(`/api/rooms/${selectedRoom.id}/messages?limit=50`);
      const data = await res.json();
      const msgs = data.messages || [];
      setMessages(msgs);
      setHasMoreMessages(msgs.length >= 50);
      // Cache the messages
      setCachedMessages(selectedRoom.id, msgs);
    } catch (e) {
      console.error('Failed to load messages:', e);
      // Offline - keep using cached messages
    }
  }, [selectedRoom]);

  // Load older messages (infinite scroll)
  const loadOlderMessages = useCallback(async () => {
    if (!selectedRoom || messages.length === 0 || loadingMore || !hasMoreMessages) return;
    const firstMessage = messages[0];
    setLoadingMore(true);
    try {
      const container = messagesContainerRef.current;
      const scrollHeightBefore = container?.scrollHeight || 0;

      const res = await fetch(`/api/rooms/${selectedRoom.id}/messages?before=${encodeURIComponent(firstMessage.created_at)}&limit=30`);
      const data = await res.json();
      const olderMessages = data.messages || [];

      if (olderMessages.length > 0) {
        setMessages(prev => [...olderMessages, ...prev]);
        // Maintain scroll position
        requestAnimationFrame(() => {
          if (container) {
            const scrollHeightAfter = container.scrollHeight;
            container.scrollTop = scrollHeightAfter - scrollHeightBefore;
          }
        });
      }
      setHasMoreMessages(olderMessages.length >= 30);
    } catch (e) {
      console.error('Failed to load older messages:', e);
    } finally {
      setLoadingMore(false);
    }
  }, [selectedRoom, messages, loadingMore, hasMoreMessages]);

  // Poll for new messages only (optimized with cache update)
  const pollNewMessages = useCallback(async () => {
    if (!selectedRoom || messages.length === 0) return;
    const lastMessage = messages[messages.length - 1];
    try {
      const res = await fetch(`/api/rooms/${selectedRoom.id}/messages?since=${encodeURIComponent(lastMessage.created_at)}`);
      const data = await res.json();
      if (data.messages && data.messages.length > 0) {
        setMessages(prev => {
          const newMessages = [...prev, ...data.messages];
          setCachedMessages(selectedRoom.id, newMessages);
          return newMessages;
        });
      }
    } catch (e) {
      console.error('Failed to poll messages:', e);
    }
  }, [selectedRoom, messages]);

  useEffect(() => {
    setHasMoreMessages(true);
    loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    // Polling for new messages (optimized - only fetch new ones)
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
    }

    if (messages.length > 0) {
      pollIntervalRef.current = window.setInterval(pollNewMessages, 3000);
    }

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [pollNewMessages, messages.length > 0]);

  // Scroll to bottom on new messages (only for new messages, not older ones)
  const prevMessagesLengthRef = useRef(0);
  useEffect(() => {
    // Only scroll to bottom if messages were added at the end
    if (messages.length > prevMessagesLengthRef.current) {
      const lastMsg = messages[messages.length - 1];
      const prevLastMsg = prevMessagesLengthRef.current > 0 ? messages[prevMessagesLengthRef.current - 1] : null;
      // Check if it's a new message at the end (not older messages prepended)
      if (!prevLastMsg || lastMsg.created_at > prevLastMsg.created_at) {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
    }
    prevMessagesLengthRef.current = messages.length;
  }, [messages]);

  // Infinite scroll handler
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const target = e.target as HTMLDivElement;
    if (target.scrollTop < 100 && hasMoreMessages && !loadingMore) {
      loadOlderMessages();
    }
  }, [hasMoreMessages, loadingMore, loadOlderMessages]);

  // Handle file upload
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append('file', file);

        const res = await fetch('/api/upload', {
          method: 'POST',
          body: formData,
        });

        if (res.ok) {
          const data = await res.json();
          const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined;
          setUploadedFiles(prev => [...prev, { ...data, preview }]);
        }
      }
    } catch (e) {
      console.error('Failed to upload file:', e);
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Remove uploaded file
  const removeUploadedFile = (index: number) => {
    setUploadedFiles(prev => {
      const file = prev[index];
      if (file.preview) {
        URL.revokeObjectURL(file.preview);
      }
      return prev.filter((_, i) => i !== index);
    });
  };

  // Send message
  const sendMessage = async () => {
    if ((!newMessage.trim() && uploadedFiles.length === 0) || !selectedRoom || !member || sending) return;

    setSending(true);
    try {
      const attachments = uploadedFiles.map(f => ({
        r2_key: f.r2_key,
        content_type: f.content_type,
        filename: f.filename,
        size: f.size,
      }));

      const res = await fetch(`/api/rooms/${selectedRoom.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: newMessage.trim(),
          attachments: attachments.length > 0 ? attachments : undefined,
          reply_to_id: replyTo?.id,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setMessages(prev => {
          const newMessages = [...prev, data];
          if (selectedRoom) {
            setCachedMessages(selectedRoom.id, newMessages);
          }
          return newMessages;
        });
        setNewMessage('');
        setReplyTo(null);
        // Clean up previews
        uploadedFiles.forEach(f => {
          if (f.preview) URL.revokeObjectURL(f.preview);
        });
        setUploadedFiles([]);
      }
    } catch (e) {
      console.error('Failed to send message:', e);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  };

  const getInitial = (name: string) => {
    return name.charAt(0).toUpperCase();
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Find replied message
  const getReplyMessage = (replyToId: string | null) => {
    if (!replyToId) return null;
    return messages.find(m => m.id === replyToId);
  };

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  // Login page
  if (!member) {
    return (
      <div className="login-page">
        <h1>Yurucommu</h1>
        <p>ゆるいコミュニティチャット</p>
        <a href="/api/auth/login" className="button">
          takosでログイン
        </a>
      </div>
    );
  }

  // Main chat interface
  return (
    <div className="app-layout">
      {/* Sidebar */}
      <div className="sidebar">
        <div className="sidebar-header">
          <h2>Yurucommu</h2>
          {!isOnline && <span className="offline-indicator" title="オフライン">●</span>}
        </div>

        <div className="room-list">
          {rooms.map(room => (
            <div
              key={room.id}
              className={`room-item ${selectedRoom?.id === room.id ? 'active' : ''}`}
              onClick={() => setSelectedRoom(room)}
            >
              <div className="room-name"># {room.name}</div>
              {room.description && (
                <div className="room-description">{room.description}</div>
              )}
            </div>
          ))}
        </div>

        {/* User info */}
        <div className="user-info">
          <div className="user-avatar">
            {member.avatar_url ? (
              <img src={member.avatar_url} alt={member.username} />
            ) : (
              getInitial(member.display_name || member.username)
            )}
          </div>
          <div className="user-name">{member.display_name || member.username}</div>
          <a href="/api/auth/logout" className="logout-btn" title="Logout">
            &#x2715;
          </a>
        </div>
      </div>

      {/* Chat area */}
      <div className="chat-area">
        {selectedRoom ? (
          <>
            <div className="chat-header">
              <div className="chat-header-info">
                <h3># {selectedRoom.name}</h3>
                {selectedRoom.description && <p>{selectedRoom.description}</p>}
              </div>
              <button
                className="members-toggle"
                onClick={() => setShowMembers(!showMembers)}
                title="メンバー一覧"
              >
                👥 {members.length}
              </button>
            </div>

            <div className="messages-container" ref={messagesContainerRef} onScroll={handleScroll}>
              {loadingMore && (
                <div className="loading-more">読み込み中...</div>
              )}
              {messages.length === 0 ? (
                <div className="empty-state">
                  <p>メッセージがありません</p>
                  <p>最初のメッセージを送ってみましょう</p>
                </div>
              ) : (
                messages.map(msg => {
                  const replyMsg = getReplyMessage(msg.reply_to_id);
                  const isEditing = editingMessage?.id === msg.id;
                  return (
                    <div key={msg.id} className="message">
                      <div className="message-avatar">
                        {msg.avatar_url ? (
                          <img src={msg.avatar_url} alt={msg.username} />
                        ) : (
                          getInitial(msg.display_name || msg.username)
                        )}
                      </div>
                      <div className="message-content">
                        {/* Reply indicator */}
                        {replyMsg && (
                          <div className="reply-indicator">
                            <span className="reply-icon">↩</span>
                            <span className="reply-author">{replyMsg.display_name || replyMsg.username}</span>
                            <span className="reply-preview">
                              {replyMsg.content.length > 50
                                ? replyMsg.content.slice(0, 50) + '...'
                                : replyMsg.content}
                            </span>
                          </div>
                        )}
                        <div className="message-header">
                          <span className="message-author">
                            {msg.display_name || msg.username}
                          </span>
                          <span className="message-time">{formatTime(msg.created_at)}</span>
                        </div>
                        {isEditing ? (
                          <div className="edit-form">
                            <textarea
                              className="edit-input"
                              value={editContent}
                              onChange={e => setEditContent(e.target.value)}
                              autoFocus
                            />
                            <div className="edit-actions">
                              <button className="edit-save" onClick={saveEdit}>保存</button>
                              <button className="edit-cancel" onClick={cancelEdit}>キャンセル</button>
                            </div>
                          </div>
                        ) : (
                          <>
                            {msg.content && <div className="message-text">{msg.content}</div>}
                          </>
                        )}
                        {msg.attachments && msg.attachments.length > 0 && (
                          <div className="message-attachments">
                            {msg.attachments.map(att => (
                              <a
                                key={att.id}
                                href={`/media/${att.r2_key}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="attachment"
                              >
                                {att.content_type.startsWith('image/') ? (
                                  <img src={`/media/${att.r2_key}`} alt={att.filename} />
                                ) : (
                                  <div className="attachment-file">
                                    <span className="attachment-icon">📎</span>
                                    <span className="attachment-name">{att.filename}</span>
                                    <span className="attachment-size">{formatFileSize(att.size)}</span>
                                  </div>
                                )}
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                      {/* Message actions */}
                      {member && !isEditing && (
                        <div className="message-actions">
                          <button
                            className="action-btn reply-btn"
                            onClick={() => setReplyTo(msg)}
                            title="返信"
                          >
                            ↩
                          </button>
                          {canEdit(msg) && (
                            <button
                              className="action-btn edit-btn"
                              onClick={() => startEdit(msg)}
                              title="編集"
                            >
                              ✏️
                            </button>
                          )}
                          {canDelete(msg) && (
                            <button
                              className="action-btn delete-btn"
                              onClick={() => deleteMessage(msg)}
                              title="削除"
                            >
                              🗑️
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="message-input-container">
              {/* Reply preview */}
              {replyTo && (
                <div className="reply-preview-bar">
                  <span className="reply-preview-icon">↩</span>
                  <span className="reply-preview-text">
                    <strong>{replyTo.display_name || replyTo.username}</strong>
                    への返信: {replyTo.content.length > 50 ? replyTo.content.slice(0, 50) + '...' : replyTo.content}
                  </span>
                  <button className="reply-cancel" onClick={() => setReplyTo(null)}>×</button>
                </div>
              )}

              {/* Preview uploaded files */}
              {uploadedFiles.length > 0 && (
                <div className="upload-preview">
                  {uploadedFiles.map((file, index) => (
                    <div key={index} className="upload-preview-item">
                      {file.preview ? (
                        <img src={file.preview} alt={file.filename} />
                      ) : (
                        <div className="upload-preview-file">📎 {file.filename}</div>
                      )}
                      <button
                        className="upload-preview-remove"
                        onClick={() => removeUploadedFile(index)}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="message-input-wrapper">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileSelect}
                  accept="image/*"
                  multiple
                  style={{ display: 'none' }}
                />
                <button
                  className="attach-btn"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  title="画像を添付"
                >
                  {uploading ? '...' : '📎'}
                </button>
                <textarea
                  className="message-input"
                  placeholder={`#${selectedRoom.name} にメッセージを送る`}
                  value={newMessage}
                  onChange={e => setNewMessage(e.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={1}
                />
                <button
                  className="send-btn"
                  onClick={sendMessage}
                  disabled={(!newMessage.trim() && uploadedFiles.length === 0) || sending}
                >
                  送信
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="empty-state">
            <p>ルームを選択してください</p>
          </div>
        )}
      </div>

      {/* Members Panel */}
      {showMembers && (
        <div className="members-panel">
          <div className="members-header">
            <h3>メンバー ({members.length})</h3>
            <button className="close-btn" onClick={() => setShowMembers(false)}>×</button>
          </div>
          <div className="members-list">
            {members.map(m => (
              <div key={m.id} className="member-item">
                <div className="member-avatar">
                  {m.avatar_url ? (
                    <img src={m.avatar_url} alt={m.username} />
                  ) : (
                    getInitial(m.display_name || m.username)
                  )}
                </div>
                <div className="member-info">
                  <div className="member-name">{m.display_name || m.username}</div>
                  <div className="member-role">
                    {m.role === 'owner' && '👑 オーナー'}
                    {m.role === 'moderator' && '🛡️ モデレーター'}
                    {m.role === 'member' && 'メンバー'}
                  </div>
                </div>
                {/* Role management for owners */}
                {member?.role === 'owner' && m.id !== member.id && (
                  <div className="member-actions">
                    <select
                      value={m.role}
                      onChange={e => changeRole(m.id, e.target.value)}
                      className="role-select"
                    >
                      <option value="member">メンバー</option>
                      <option value="moderator">モデレーター</option>
                      <option value="owner">オーナー</option>
                    </select>
                    {m.role !== 'owner' && (
                      <button
                        className="remove-member-btn"
                        onClick={() => removeMember(m.id)}
                        title="削除"
                      >
                        🗑️
                      </button>
                    )}
                  </div>
                )}
                {/* Remove option for moderators */}
                {member?.role === 'moderator' && m.role === 'member' && m.id !== member.id && (
                  <button
                    className="remove-member-btn"
                    onClick={() => removeMember(m.id)}
                    title="削除"
                  >
                    🗑️
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
