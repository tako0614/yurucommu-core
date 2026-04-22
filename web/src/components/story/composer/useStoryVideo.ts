import { createEffect, createSignal, onCleanup } from "solid-js";
import type {
  BackgroundFill,
  BackgroundLayer,
  StoryCanvas,
} from "../../../lib/story-canvas.ts";
import {
  getVideoDuration,
  initFFmpeg,
  isVideoFile,
} from "../../../lib/ffmpeg.ts";

interface UseStoryVideoOptions {
  storyCanvas: StoryCanvas | null;
  setUploading: (value: boolean) => void;
  setError: (message: string) => void;
  maxVideoSize: number;
  onBackgroundChange: () => void;
}

export function useStoryVideo(opts: UseStoryVideoOptions) {
  const [videoFile, setVideoFile] = createSignal<File | null>(null);
  const [videoPreview, setVideoPreview] = createSignal<string | null>(null);
  let videoPreviewRef: string | null = null;
  const [videoDuration, setVideoDuration] = createSignal<number>(5);
  const [savedBackground, setSavedBackground] = createSignal<
    BackgroundFill | null
  >(null);
  const [videoScale, setVideoScale] = createSignal(1);
  const [videoPosition, setVideoPosition] = createSignal({ x: 0, y: 0 });
  const [videoRotation, setVideoRotation] = createSignal(0);
  const [ffmpegReady, setFfmpegReady] = createSignal(false);
  const [ffmpegLoading, setFfmpegLoading] = createSignal(false);
  let videoInputRef!: HTMLInputElement;
  let videoRef!: HTMLVideoElement;

  // Keep ref in sync for cleanup on unmount
  createEffect(() => {
    videoPreviewRef = videoPreview();
  });

  // Cleanup video preview URL on unmount
  createEffect(() => {
    onCleanup(() => {
      if (videoPreviewRef) {
        URL.revokeObjectURL(videoPreviewRef);
      }
    });
  });

  createEffect(() => {
    const file = videoFile();
    if (!file) return;
    if (ffmpegReady()) return;

    const loadFFmpeg = async () => {
      setFfmpegLoading(true);
      try {
        await initFFmpeg();
        setFfmpegReady(true);
      } catch (e) {
        console.error("Failed to load FFmpeg:", e);
        opts.setError(
          "FFmpegの読み込みに失敗しました。動画機能は使用できません。",
        );
      } finally {
        setFfmpegLoading(false);
      }
    };
    loadFFmpeg();
  });

  const handleVideoSelect = async (
    e: Event & { currentTarget: HTMLInputElement },
  ) => {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!file || !opts.storyCanvas) return;

    if (!isVideoFile(file)) {
      opts.setError("動画ファイルを選択してください");
      return;
    }

    if (file.size > opts.maxVideoSize) {
      opts.setError(
        `動画サイズが大きすぎます（最大${opts.maxVideoSize / 1024 / 1024}MB）`,
      );
      return;
    }

    opts.setUploading(true);
    try {
      const currentPreview = videoPreview();
      if (currentPreview) {
        URL.revokeObjectURL(currentPreview);
      }
      const preview = URL.createObjectURL(file);
      const duration = await getVideoDuration(file);

      const bgLayer = opts.storyCanvas.getLayers().find((layer) =>
        layer.type === "background"
      ) as BackgroundLayer | undefined;
      if (bgLayer) {
        setSavedBackground(bgLayer.fill);
        opts.storyCanvas.setBackground({ type: "transparent" });
        opts.onBackgroundChange();
      }

      setVideoFile(file);
      setVideoPreview(preview);
      setVideoDuration(duration);
    } catch (err) {
      console.error("Failed to process video:", err);
      opts.setError("動画の処理に失敗しました");
    } finally {
      opts.setUploading(false);
      if (videoInputRef) videoInputRef.value = "";
    }
  };

  const clearVideo = () => {
    const currentPreview = videoPreview();
    if (currentPreview) {
      URL.revokeObjectURL(currentPreview);
    }
    setVideoFile(null);
    setVideoPreview(null);
    setVideoScale(1);
    setVideoPosition({ x: 0, y: 0 });
    setVideoRotation(0);

    const bg = savedBackground();
    if (bg && opts.storyCanvas) {
      opts.storyCanvas.setBackground(bg);
      setSavedBackground(null);
      opts.onBackgroundChange();
    }
  };

  return {
    videoFile,
    videoPreview,
    videoDuration,
    get videoInputRef() {
      return videoInputRef;
    },
    set videoInputRef(el: HTMLInputElement) {
      videoInputRef = el;
    },
    get videoRef() {
      return videoRef;
    },
    set videoRef(el: HTMLVideoElement) {
      videoRef = el;
    },
    videoScale,
    setVideoScale,
    videoPosition,
    setVideoPosition,
    videoRotation,
    setVideoRotation,
    ffmpegReady,
    ffmpegLoading,
    handleVideoSelect,
    clearVideo,
  };
}
