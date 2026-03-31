/**
 * Sticker Panel for Story Editor
 *
 * Provides emoji picker for adding sticker layers.
 */

import { EmojiPicker } from './EmojiPicker.tsx';

interface StickerPanelProps {
  onAddEmoji: (emoji: string) => void;
}

export function StickerPanel(props: StickerPanelProps) {
  return (
    <div class="space-y-4">
      <h3 class="text-white font-medium">スタンプ</h3>
      <EmojiPicker onSelect={props.onAddEmoji} />
    </div>
  );
}
