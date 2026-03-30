import { useCallback } from 'react';
import type { StoryCanvas, Layer } from '../../../lib/story-canvas';

interface UseStoryLayerActionsOptions {
  storyCanvas: StoryCanvas | null;
  selectedLayerId: string | null;
  selectLayer: (id: string | null) => void;
  onUpdate: () => void;
}

export function useStoryLayerActions({
  storyCanvas,
  selectedLayerId,
  selectLayer,
  onUpdate,
}: UseStoryLayerActionsOptions) {
  const handleUpdateLayer = useCallback((updates: Partial<Layer>) => {
    if (!storyCanvas || !selectedLayerId) return;

    storyCanvas.updateLayer(selectedLayerId, updates);
    onUpdate();
  }, [storyCanvas, selectedLayerId, onUpdate]);

  const handleDeleteLayer = useCallback(() => {
    if (!storyCanvas || !selectedLayerId) return;

    storyCanvas.removeLayer(selectedLayerId);
    selectLayer(null);
    onUpdate();
  }, [storyCanvas, selectedLayerId, selectLayer, onUpdate]);

  const handleBringToFront = useCallback(() => {
    if (!storyCanvas || !selectedLayerId) return;

    storyCanvas.bringToFront(selectedLayerId);
    onUpdate();
  }, [storyCanvas, selectedLayerId, onUpdate]);

  const handleSendToBack = useCallback(() => {
    if (!storyCanvas || !selectedLayerId) return;

    storyCanvas.sendToBack(selectedLayerId);
    onUpdate();
  }, [storyCanvas, selectedLayerId, onUpdate]);

  return {
    handleUpdateLayer,
    handleDeleteLayer,
    handleBringToFront,
    handleSendToBack,
  };
}
