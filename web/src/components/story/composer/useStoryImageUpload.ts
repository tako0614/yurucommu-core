import { createEffect, onCleanup } from "solid-js";
import type { StoryCanvas } from "../../../lib/story-canvas.ts";

// File size limit
const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB

interface UseStoryImageUploadOptions {
  storyCanvas: StoryCanvas | null;
  selectLayer: (id: string | null) => void;
  setUploading: (value: boolean) => void;
  setError: (message: string) => void;
  onUpdate: () => void;
}

export function useStoryImageUpload(opts: UseStoryImageUploadOptions) {
  let fileInputRef!: HTMLInputElement;
  const objectUrls = new Set<string>();

  // Cleanup object URLs on unmount to prevent memory leaks
  createEffect(() => {
    onCleanup(() => {
      objectUrls.forEach((url) => {
        URL.revokeObjectURL(url);
      });
      objectUrls.clear();
    });
  });

  const handleImageSelect = async (
    e: Event & { currentTarget: HTMLInputElement },
  ) => {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!file || !opts.storyCanvas) return;

    if (!file.type.startsWith("image/")) {
      opts.setError("画像ファイルを選択してください");
      return;
    }

    if (file.size > MAX_IMAGE_SIZE) {
      opts.setError(
        `画像サイズが大きすぎます（最大${MAX_IMAGE_SIZE / 1024 / 1024}MB）`,
      );
      return;
    }

    opts.setUploading(true);
    try {
      const preview = URL.createObjectURL(file);
      // Track the object URL for cleanup
      objectUrls.add(preview);
      const layer = await opts.storyCanvas.createMediaLayer(preview);
      opts.storyCanvas.addLayer(layer);
      opts.selectLayer(layer.id);
      opts.onUpdate();
    } catch (err) {
      console.error("Failed to add image:", err);
      opts.setError("画像の追加に失敗しました");
    } finally {
      opts.setUploading(false);
      if (fileInputRef) fileInputRef.value = "";
    }
  };

  return {
    get fileInputRef() {
      return fileInputRef;
    },
    set fileInputRef(el: HTMLInputElement) {
      fileInputRef = el;
    },
    handleImageSelect,
  };
}
