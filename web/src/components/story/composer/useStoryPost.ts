import { useState, useCallback } from 'react';
import type { StoryCanvas, TextLayer } from '../../../lib/story-canvas.ts';
import type { StoryOverlay } from '../../../types/index.ts';
import { createStory, uploadMedia } from '../../../lib/api.ts';
import {
  exportCanvasWithVideo,
  FFmpegError,
  type VideoTransform,
} from '../../../lib/ffmpeg.ts';

interface UseStoryPostOptions {
  storyCanvas: StoryCanvas | null;
  videoFile: File | null;
  videoScale: number;
  videoPosition: { x: number; y: number };
  videoRotation: number;
  displayScale: number;
  ffmpegReady: boolean;
  overlays: StoryOverlay[];
  setError: (message: string | null) => void;
  onSuccess: () => void;
  onClose: () => void;
}

export function useStoryPost({
  storyCanvas,
  videoFile,
  videoScale,
  videoPosition,
  videoRotation,
  displayScale,
  ffmpegReady,
  overlays,
  setError,
  onSuccess,
  onClose,
}: UseStoryPostOptions) {
  const [posting, setPosting] = useState(false);
  const [progress, setProgress] = useState(0);

  const calculateDuration = useCallback((): number => {
    if (!storyCanvas) return 5;

    const layers = storyCanvas.getLayers();
    let seconds = 3;

    const textLayers = layers.filter(l => l.type === 'text') as TextLayer[];
    seconds += textLayers.length * 2;

    for (const layer of textLayers) {
      seconds += Math.ceil(layer.content.length / 20);
    }

    return Math.max(3, Math.min(15, seconds));
  }, [storyCanvas]);

  const handlePost = useCallback(async () => {
    if (!storyCanvas || posting) return;
    // Video mode requires FFmpeg to be ready
    if (videoFile && !ffmpegReady) {
      setError('動画処理の準備中です。しばらくお待ちください。');
      return;
    }

    setPosting(true);
    setProgress(0);
    setError(null);

    try {
      // Render canvas first
      await storyCanvas.render();
      const canvas = storyCanvas.getCanvas();

      let blob: Blob;
      let contentType: string;
      let duration: number;

      if (videoFile) {
        // Video mode: export canvas overlay on video through FFmpeg
        setProgress(10);
        const transform: VideoTransform = {
          scale: videoScale,
          position: videoPosition,
          rotation: videoRotation,
          displayScale: displayScale,
        };
        const result = await exportCanvasWithVideo(
          canvas,
          videoFile,
          (p) => setProgress(10 + p * 0.6), // 10-70%
          transform
        );
        blob = result.blob;
        contentType = 'video/mp4';
        duration = result.duration;
      } else {
        // Image mode: direct Canvas.toBlob() (no FFmpeg needed, faster)
        setProgress(10);
        blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            (b) => {
              if (b) resolve(b);
              else reject(new Error('Failed to export canvas'));
            },
            'image/jpeg',
            0.92 // Quality 92%
          );
        });
        contentType = 'image/jpeg';
        duration = calculateDuration();
        setProgress(50);
      }

      // Upload to server
      setProgress(70);
      const filename = videoFile ? 'story.mp4' : 'story.jpg';
      const file = new File([blob], filename, { type: contentType });
      const result = await uploadMedia(file);

      // Create story
      setProgress(90);
      await createStory({
        attachment: {
          r2_key: result.r2_key,
          content_type: contentType,
        },
        displayDuration: `PT${Math.round(duration)}S`,
        overlays: overlays.length > 0 ? overlays : undefined,
      });

      setProgress(100);
      onSuccess();
      onClose();
    } catch (err) {
      console.error('Failed to create story:', err);
      if (err instanceof FFmpegError) {
        setError(`動画処理エラー: ${err.message}`);
      } else if (err instanceof Error) {
        setError(`エラー: ${err.message}`);
      } else {
        setError('ストーリーの作成に失敗しました');
      }
    } finally {
      setPosting(false);
      setProgress(0);
    }
  }, [
    storyCanvas, posting, videoFile, ffmpegReady,
    videoScale, videoPosition, videoRotation, displayScale,
    calculateDuration, overlays, setError, onSuccess, onClose,
  ]);

  return {
    posting,
    progress,
    handlePost,
  };
}
