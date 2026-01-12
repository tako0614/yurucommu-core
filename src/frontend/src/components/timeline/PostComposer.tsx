import { useState } from 'react';
import { useI18n } from '../../lib/i18n';

interface PostComposerProps {
  onPost: (content: string) => Promise<void>;
}

export function PostComposer({ onPost }: PostComposerProps) {
  const { t } = useI18n();
  const [content, setContent] = useState('');
  const [posting, setPosting] = useState(false);

  const handleSubmit = async () => {
    if (!content.trim() || posting) return;
    setPosting(true);
    try {
      await onPost(content.trim());
      setContent('');
    } catch (e) {
      console.error('Failed to post:', e);
    } finally {
      setPosting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      handleSubmit();
    }
  };

  const charCount = content.length;
  const maxChars = 500;
  const isOverLimit = charCount > maxChars;

  return (
    <div className="px-4 py-3 border-b border-neutral-900">
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={t('composer.placeholder')}
        rows={3}
        className="w-full bg-transparent text-white placeholder-neutral-600 resize-none outline-none text-[15px] leading-relaxed"
      />
      <div className="flex items-center justify-between mt-3">
        <div className={`text-sm ${isOverLimit ? 'text-red-500' : 'text-neutral-600'}`}>
          {charCount > 0 && `${charCount}/${maxChars}`}
        </div>
        <button
          onClick={handleSubmit}
          disabled={!content.trim() || posting || isOverLimit}
          className="px-5 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-neutral-800 disabled:text-neutral-600 rounded-full font-bold text-sm transition-colors"
        >
          {posting ? t('common.loading') : t('composer.post')}
        </button>
      </div>
    </div>
  );
}
