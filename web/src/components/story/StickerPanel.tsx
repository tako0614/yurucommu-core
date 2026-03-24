/**
 * Sticker Panel for Story Editor
 *
 * Provides emoji picker for adding sticker layers.
 */

import { EmojiPicker } from './EmojiPicker';

interface StickerPanelProps {
  onAddEmoji: (emoji: string) => void;
}

export function StickerPanel({ onAddEmoji }: StickerPanelProps) {
  return (
    <div className="space-y-4">
      <h3 className="text-white font-medium">スタンプ</h3>
      <EmojiPicker onSelect={onAddEmoji} />
    </div>
  );
}
