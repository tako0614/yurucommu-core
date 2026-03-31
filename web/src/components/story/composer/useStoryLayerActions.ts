import type { StoryCanvas, Layer } from '../../../lib/story-canvas.ts';

interface UseStoryLayerActionsOptions {
  storyCanvas: StoryCanvas | null;
  selectedLayerId: string | null;
  selectLayer: (id: string | null) => void;
  onUpdate: () => void;
}

export function useStoryLayerActions(opts: UseStoryLayerActionsOptions) {
  const handleUpdateLayer = (updates: Partial<Layer>) => {
    if (!opts.storyCanvas || !opts.selectedLayerId) return;

    opts.storyCanvas.updateLayer(opts.selectedLayerId, updates);
    opts.onUpdate();
  };

  const handleDeleteLayer = () => {
    if (!opts.storyCanvas || !opts.selectedLayerId) return;

    opts.storyCanvas.removeLayer(opts.selectedLayerId);
    opts.selectLayer(null);
    opts.onUpdate();
  };

  const handleBringToFront = () => {
    if (!opts.storyCanvas || !opts.selectedLayerId) return;

    opts.storyCanvas.bringToFront(opts.selectedLayerId);
    opts.onUpdate();
  };

  const handleSendToBack = () => {
    if (!opts.storyCanvas || !opts.selectedLayerId) return;

    opts.storyCanvas.sendToBack(opts.selectedLayerId);
    opts.onUpdate();
  };

  return {
    handleUpdateLayer,
    handleDeleteLayer,
    handleBringToFront,
    handleSendToBack,
  };
}
