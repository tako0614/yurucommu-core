import { useRef, useEffect, useCallback } from 'react';
import type { StoryCanvas } from '../../../lib/story-canvas';

// File size limit
const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB

interface UseStoryImageUploadOptions {
  storyCanvas: StoryCanvas | null;
  selectLayer: (id: string | null) => void;
  setUploading: (value: boolean) => void;
  setError: (message: string) => void;
  onUpdate: () => void;
}

export function useStoryImageUpload({
  storyCanvas,
  selectLayer,
  setUploading,
  setError,
  onUpdate,
}: UseStoryImageUploadOptions) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const objectUrlsRef = useRef<Set<string>>(new Set());

  // Cleanup object URLs on unmount to prevent memory leaks
  useEffect(() => {
    const objectUrls = objectUrlsRef.current;
    return () => {
      objectUrls.forEach(url => {
        URL.revokeObjectURL(url);
      });
      objectUrls.clear();
    };
  }, []);

  const handleImageSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !storyCanvas) return;

    if (!file.type.startsWith('image/')) {
      setError('画像ファイルを選択してください');
      return;
    }

    if (file.size > MAX_IMAGE_SIZE) {
      setError(`画像サイズが大きすぎます（最大${MAX_IMAGE_SIZE / 1024 / 1024}MB）`);
      return;
    }

    setUploading(true);
    try {
      const preview = URL.createObjectURL(file);
      // Track the object URL for cleanup
      objectUrlsRef.current.add(preview);
      const layer = await storyCanvas.createMediaLayer(preview);
      storyCanvas.addLayer(layer);
      selectLayer(layer.id);
      onUpdate();
    } catch (err) {
      console.error('Failed to add image:', err);
      setError('画像の追加に失敗しました');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [storyCanvas, selectLayer, setUploading, setError, onUpdate]);

  return {
    fileInputRef,
    handleImageSelect,
  };
}
