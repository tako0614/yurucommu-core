/**
 * Sticker Panel for Story Editor
 *
 * Provides emoji picker for adding sticker layers.
 */

import { EmojiPicker } from "./EmojiPicker.tsx";
import { useI18n } from "../../lib/i18n.tsx";

interface StickerPanelProps {
  onAddEmoji: (emoji: string) => void;
}

export function StickerPanel(props: StickerPanelProps) {
  const { t } = useI18n();
  return (
    <div class="space-y-4">
      <h3 class="text-white font-medium">{t("story.stamp")}</h3>
      <EmojiPicker onSelect={props.onAddEmoji} />
    </div>
  );
}
