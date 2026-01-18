import type { ChangeEvent, RefObject } from 'react';
import type { Actor } from '../../types';
import { UserAvatar } from '../UserAvatar';
import { CloseIcon, CloseIconLarge, ImageIcon } from './TimelineIcons';
import type { UploadedMedia } from './types';

interface TimelinePostModalProps {
  isOpen: boolean;
  actor: Actor;
  postContent: string;
  onPostContentChange: (value: string) => void;
  placeholder: string;
  submitLabel: string;
  submittingLabel: string;
  onClose: () => void;
  onSubmit: () => Promise<boolean>;
  posting: boolean;
  fileInputRef: RefObject<HTMLInputElement>;
  onFileSelect: (event: ChangeEvent<HTMLInputElement>) => void;
  uploadedMedia: UploadedMedia[];
  onRemoveMedia: (index: number) => void;
  uploading: boolean;
  uploadError: string | null;
}

export function TimelinePostModal({
  isOpen,
  actor,
  postContent,
  onPostContentChange,
  placeholder,
  submitLabel,
  submittingLabel,
  onClose,
  onSubmit,
  posting,
  fileInputRef,
  onFileSelect,
  uploadedMedia,
  onRemoveMedia,
  uploading,
  uploadError,
}: TimelinePostModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-start justify-center z-50 p-4 pt-12">
      <div className="bg-black w-full max-w-lg rounded-2xl border border-neutral-800">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
          <button onClick={onClose} aria-label="Close" className="text-white hover:text-neutral-400 transition-colors">
            <CloseIconLarge />
          </button>
          <button
            onClick={async () => {
              const success = await onSubmit();
              if (success) {
                onClose();
              }
            }}
            disabled={(!postContent.trim() && uploadedMedia.length === 0) || posting}
            className="px-4 py-1.5 bg-blue-500 hover:bg-blue-600 disabled:bg-neutral-700 disabled:text-neutral-500 rounded-full font-bold text-sm transition-colors"
          >
            {posting ? submittingLabel : submitLabel}
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-4">
          <div className="flex gap-3">
            <UserAvatar avatarUrl={actor.icon_url} name={actor.name || actor.username} size={48} />
            <div className="flex-1">
              <textarea
                value={postContent}
                onChange={(e) => onPostContentChange(e.target.value)}
                placeholder={placeholder}
                className="w-full bg-transparent text-white placeholder-neutral-500 resize-none outline-none text-lg min-h-[120px]"
                autoFocus
              />
              {uploadedMedia.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {uploadedMedia.map((media, idx) => (
                    <div key={media.r2_key} className="relative">
                      <img src={media.preview} alt="" className="w-20 h-20 object-cover rounded-lg" />
                      <button
                        onClick={() => onRemoveMedia(idx)}
                        aria-label="Remove media"
                        className="absolute -top-1 -right-1 bg-black/70 rounded-full p-0.5 hover:bg-black"
                      >
                        <CloseIcon />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center gap-2 px-4 py-3 border-t border-neutral-800">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={onFileSelect}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || uploadedMedia.length >= 4}
            aria-label="Add image"
            className="p-2 text-blue-500 hover:bg-blue-500/10 rounded-full disabled:opacity-50 transition-colors"
          >
            <ImageIcon />
          </button>
          {uploading && <span className="text-sm text-neutral-500">アップロード中...</span>}
          {uploadError && <span className="text-sm text-red-500">{uploadError}</span>}
        </div>
      </div>
    </div>
  );
}
