import { useCallback, useEffect, useRef, useState } from 'react';
import type { BackgroundFill, BackgroundLayer, StoryCanvas } from '../../../lib/storyCanvas';
import { getVideoDuration, initFFmpeg, isVideoFile } from '../../../lib/ffmpeg';

interface UseStoryVideoOptions {
  storyCanvas: StoryCanvas | null;
  setUploading: (value: boolean) => void;
  setError: (message: string) => void;
  maxVideoSize: number;
  onBackgroundChange: () => void;
}

export function useStoryVideo({
  storyCanvas,
  setUploading,
  setError,
  maxVideoSize,
  onBackgroundChange,
}: UseStoryVideoOptions) {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const videoPreviewRef = useRef<string | null>(null);
  const [videoDuration, setVideoDuration] = useState<number>(5);
  const [savedBackground, setSavedBackground] = useState<BackgroundFill | null>(null);
  const [videoScale, setVideoScale] = useState(1);
  const [videoPosition, setVideoPosition] = useState({ x: 0, y: 0 });
  const [videoRotation, setVideoRotation] = useState(0);
  const [ffmpegReady, setFfmpegReady] = useState(false);
  const [ffmpegLoading, setFfmpegLoading] = useState(false);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Keep ref in sync for cleanup on unmount
  useEffect(() => {
    videoPreviewRef.current = videoPreview;
  }, [videoPreview]);

  // Cleanup video preview URL on unmount
  useEffect(() => {
    return () => {
      if (videoPreviewRef.current) {
        URL.revokeObjectURL(videoPreviewRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!videoFile) return;
    if (ffmpegReady) return;

    const loadFFmpeg = async () => {
      setFfmpegLoading(true);
      try {
        await initFFmpeg();
        setFfmpegReady(true);
      } catch (e) {
        console.error('Failed to load FFmpeg:', e);
        setError('FFmpegの読み込みに失敗しました。動画機能は使用できません。');
      } finally {
        setFfmpegLoading(false);
      }
    };
    loadFFmpeg();
  }, [videoFile, ffmpegReady, setError]);

  const handleVideoSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !storyCanvas) return;

    if (!isVideoFile(file)) {
      setError('動画ファイルを選択してください');
      return;
    }

    if (file.size > maxVideoSize) {
      setError(`動画サイズが大きすぎます（最大${maxVideoSize / 1024 / 1024}MB）`);
      return;
    }

    setUploading(true);
    try {
      if (videoPreview) {
        URL.revokeObjectURL(videoPreview);
      }
      const preview = URL.createObjectURL(file);
      const duration = await getVideoDuration(file);

      const bgLayer = storyCanvas.getLayers().find((layer) => layer.type === 'background') as BackgroundLayer | undefined;
      if (bgLayer) {
        setSavedBackground(bgLayer.fill);
        storyCanvas.setBackground({ type: 'transparent' });
        onBackgroundChange();
      }

      setVideoFile(file);
      setVideoPreview(preview);
      setVideoDuration(duration);
    } catch (err) {
      console.error('Failed to process video:', err);
      setError('動画の処理に失敗しました');
    } finally {
      setUploading(false);
      if (videoInputRef.current) videoInputRef.current.value = '';
    }
  }, [storyCanvas, maxVideoSize, setError, setUploading, onBackgroundChange, videoPreview]);

  const clearVideo = useCallback(() => {
    if (videoPreview) {
      URL.revokeObjectURL(videoPreview);
    }
    setVideoFile(null);
    setVideoPreview(null);
    setVideoScale(1);
    setVideoPosition({ x: 0, y: 0 });
    setVideoRotation(0);

    if (savedBackground && storyCanvas) {
      storyCanvas.setBackground(savedBackground);
      setSavedBackground(null);
      onBackgroundChange();
    }
  }, [videoPreview, savedBackground, storyCanvas, onBackgroundChange]);

  return {
    videoFile,
    videoPreview,
    videoDuration,
    videoInputRef,
    videoRef,
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
