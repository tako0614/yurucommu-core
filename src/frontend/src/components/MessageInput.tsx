import { useState, useRef } from 'react';
import { Message, UploadedFile } from '../types';
import { uploadFile } from '../lib/api';

interface MessageInputProps {
  roomName: string;
  replyTo: Message | null;
  onCancelReply: () => void;
  onSend: (content: string, attachments: UploadedFile[], replyToId?: string) => void;
  disabled?: boolean;
}

export function MessageInput({
  roomName,
  replyTo,
  onCancelReply,
  onSend,
  disabled = false,
}: MessageInputProps) {
  const [newMessage, setNewMessage] = useState('');
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const data = await uploadFile(file);
        const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined;
        setUploadedFiles(prev => [...prev, { ...data, preview }]);
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

  const removeUploadedFile = (index: number) => {
    setUploadedFiles(prev => {
      const file = prev[index];
      if (file.preview) {
        URL.revokeObjectURL(file.preview);
      }
      return prev.filter((_, i) => i !== index);
    });
  };

  const handleSend = async () => {
    if ((!newMessage.trim() && uploadedFiles.length === 0) || sending || disabled) return;

    setSending(true);
    try {
      await onSend(newMessage.trim(), uploadedFiles, replyTo?.id);
      setNewMessage('');
      uploadedFiles.forEach(f => {
        if (f.preview) URL.revokeObjectURL(f.preview);
      });
      setUploadedFiles([]);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="p-4 border-t border-neutral-700 bg-neutral-900">
      {/* Reply preview */}
      {replyTo && (
        <div className="flex items-center gap-2 px-4 py-2 mb-2 bg-neutral-800 border-b border-neutral-700 text-sm rounded-t-md">
          <span className="text-blue-500">↩</span>
          <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-neutral-500">
            <strong className="text-neutral-100">{replyTo.display_name || replyTo.username}</strong>
            への返信: {replyTo.content.length > 50 ? replyTo.content.slice(0, 50) + '...' : replyTo.content}
          </span>
          <button
            className="bg-transparent border-none text-neutral-500 cursor-pointer px-2 py-1 text-lg hover:text-neutral-100"
            onClick={onCancelReply}
          >
            ×
          </button>
        </div>
      )}

      {/* Preview uploaded files */}
      {uploadedFiles.length > 0 && (
        <div className="flex flex-wrap gap-2 px-4 py-2 mb-2 bg-neutral-800 border-b border-neutral-700 rounded-t-md">
          {uploadedFiles.map((file, index) => (
            <div key={index} className="relative inline-block">
              {file.preview ? (
                <img src={file.preview} alt={file.filename} className="w-15 h-15 object-cover rounded-md" />
              ) : (
                <div className="flex items-center px-2 py-1 bg-neutral-700 rounded-md text-xs h-15">
                  📎 {file.filename}
                </div>
              )}
              <button
                className="absolute -top-1.5 -right-1.5 w-5 h-5 p-0 bg-red-500 text-white border-none rounded-full text-xs cursor-pointer flex items-center justify-center hover:bg-red-600"
                onClick={() => removeUploadedFile(index)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileSelect}
          accept="image/*"
          multiple
          className="hidden"
        />
        <button
          className="bg-transparent border-none p-2 text-xl cursor-pointer text-neutral-500 hover:text-neutral-100 disabled:text-neutral-700 disabled:cursor-not-allowed"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading || disabled}
          title="画像を添付"
        >
          {uploading ? '...' : '📎'}
        </button>
        <textarea
          className="flex-1 bg-neutral-800 border border-neutral-700 rounded-md px-4 py-3 text-neutral-100 text-base resize-none min-h-[44px] max-h-[200px] focus:outline-none focus:border-blue-600 placeholder:text-neutral-600"
          placeholder={`#${roomName} にメッセージを送る`}
          value={newMessage}
          onChange={e => setNewMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={disabled}
        />
        <button
          className="bg-blue-600 border-none rounded-md px-5 text-white cursor-pointer font-medium hover:bg-blue-700 disabled:bg-neutral-700 disabled:cursor-not-allowed"
          onClick={handleSend}
          disabled={(!newMessage.trim() && uploadedFiles.length === 0) || sending || disabled}
        >
          送信
        </button>
      </div>
    </div>
  );
}
