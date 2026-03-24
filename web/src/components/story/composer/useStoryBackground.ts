import { useEffect } from 'react';
import type { BackgroundFill, StoryCanvas } from '../../../lib/storyCanvas';

interface StoryBackgroundOptions {
  storyCanvas: StoryCanvas | null;
  backgroundType: 'solid' | 'gradient';
  solidColor: string;
  gradientColors: string[];
  gradientAngle: number;
  onUpdate: () => void;
}

export function useStoryBackground({
  storyCanvas,
  backgroundType,
  solidColor,
  gradientColors,
  gradientAngle,
  onUpdate,
}: StoryBackgroundOptions) {
  useEffect(() => {
    if (!storyCanvas) return;

    let fill: BackgroundFill;
    if (backgroundType === 'solid') {
      fill = { type: 'solid', color: solidColor };
    } else {
      fill = { type: 'gradient', colors: gradientColors, angle: gradientAngle };
    }

    storyCanvas.setBackground(fill);
    onUpdate();
  }, [storyCanvas, backgroundType, solidColor, gradientColors, gradientAngle, onUpdate]);
}
