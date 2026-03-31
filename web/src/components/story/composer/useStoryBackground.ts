import { createEffect } from 'solid-js';
import type { BackgroundFill, StoryCanvas } from '../../../lib/story-canvas.ts';

interface StoryBackgroundOptions {
  storyCanvas: StoryCanvas | null;
  backgroundType: 'solid' | 'gradient';
  solidColor: string;
  gradientColors: string[];
  gradientAngle: number;
  onUpdate: () => void;
}

export function useStoryBackground(opts: StoryBackgroundOptions) {
  createEffect(() => {
    if (!opts.storyCanvas) return;

    let fill: BackgroundFill;
    if (opts.backgroundType === 'solid') {
      fill = { type: 'solid', color: opts.solidColor };
    } else {
      fill = { type: 'gradient', colors: opts.gradientColors, angle: opts.gradientAngle };
    }

    opts.storyCanvas.setBackground(fill);
    opts.onUpdate();
  });
}
