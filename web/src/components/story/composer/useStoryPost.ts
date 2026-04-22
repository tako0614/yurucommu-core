import { createSignal } from "solid-js";
import type { StoryCanvas, TextLayer } from "../../../lib/story-canvas.ts";
import type { StoryOverlay } from "../../../types/index.ts";
import { createStory, uploadMedia } from "../../../lib/api.ts";
import {
  exportCanvasWithVideo,
  FFmpegError,
  type VideoTransform,
} from "../../../lib/ffmpeg.ts";

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

export function useStoryPost(opts: UseStoryPostOptions) {
  const [posting, setPosting] = createSignal(false);
  const [progress, setProgress] = createSignal(0);

  const calculateDuration = (): number => {
    if (!opts.storyCanvas) return 5;

    const layers = opts.storyCanvas.getLayers();
    let seconds = 3;

    const textLayers = layers.filter((l) => l.type === "text") as TextLayer[];
    seconds += textLayers.length * 2;

    for (const layer of textLayers) {
      seconds += Math.ceil(layer.content.length / 20);
    }

    return Math.max(3, Math.min(15, seconds));
  };

  const handlePost = async () => {
    if (!opts.storyCanvas || posting()) return;
    // Video mode requires FFmpeg to be ready
    if (opts.videoFile && !opts.ffmpegReady) {
      opts.setError("動画処理の準備中です。しばらくお待ちください。");
      return;
    }

    setPosting(true);
    setProgress(0);
    opts.setError(null);

    try {
      // Render canvas first
      await opts.storyCanvas.render();
      const canvas = opts.storyCanvas.getCanvas();

      let blob: Blob;
      let contentType: string;
      let duration: number;

      if (opts.videoFile) {
        // Video mode: export canvas overlay on video through FFmpeg
        setProgress(10);
        const transform: VideoTransform = {
          scale: opts.videoScale,
          position: opts.videoPosition,
          rotation: opts.videoRotation,
          displayScale: opts.displayScale,
        };
        const result = await exportCanvasWithVideo(
          canvas,
          opts.videoFile,
          (p) => setProgress(10 + p * 0.6), // 10-70%
          transform,
        );
        blob = result.blob;
        contentType = "video/mp4";
        duration = result.duration;
      } else {
        // Image mode: direct Canvas.toBlob() (no FFmpeg needed, faster)
        setProgress(10);
        blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            (b) => {
              if (b) resolve(b);
              else reject(new Error("Failed to export canvas"));
            },
            "image/jpeg",
            0.92, // Quality 92%
          );
        });
        contentType = "image/jpeg";
        duration = calculateDuration();
        setProgress(50);
      }

      // Upload to server
      setProgress(70);
      const filename = opts.videoFile ? "story.mp4" : "story.jpg";
      const file = new File([blob], filename, { type: contentType });
      const result = await uploadMedia(file);

      // Create story
      setProgress(90);
      await createStory({
        attachment: {
          url: result.url,
          r2_key: result.r2_key,
          content_type: contentType,
        },
        displayDuration: `PT${Math.round(duration)}S`,
        overlays: opts.overlays.length > 0 ? opts.overlays : undefined,
      });

      setProgress(100);
      opts.onSuccess();
      opts.onClose();
    } catch (err) {
      console.error("Failed to create story:", err);
      if (err instanceof FFmpegError) {
        opts.setError(`動画処理エラー: ${err.message}`);
      } else if (err instanceof Error) {
        opts.setError(`エラー: ${err.message}`);
      } else {
        opts.setError("ストーリーの作成に失敗しました");
      }
    } finally {
      setPosting(false);
      setProgress(0);
    }
  };

  return {
    posting,
    progress,
    handlePost,
  };
}
