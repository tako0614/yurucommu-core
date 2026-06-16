// FFmpeg utility for Story composition
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import { CANVAS_HEIGHT, CANVAS_WIDTH } from "./story-canvas.ts";

// Timeout constants
const FFMPEG_TIMEOUT = 120000; // 2 min (120s)
const FFMPEG_INIT_TIMEOUT = 60000; // 1 min (initialization)
const FFMPEG_DOWNLOAD_CORE_TIMEOUT = 30000; // 30s (core download)
const FFMPEG_DOWNLOAD_WASM_TIMEOUT = 60000; // 1 min (WASM download)

// Timeout utility
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new FFmpegError(message)), ms);
  });
  return Promise.race([promise, timeout]);
}

// Singleton FFmpeg instance
let ffmpeg: FFmpeg | null = null;
let loaded = false;
let loading: Promise<void> | null = null;

// Custom error class for FFmpeg operations
export class FFmpegError extends Error {
  constructor(
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "FFmpegError";
  }
}

// Initialize FFmpeg
export async function initFFmpeg(): Promise<FFmpeg> {
  if (ffmpeg && loaded) return ffmpeg;

  if (loading) {
    // Time out the wait for in-flight initialization too
    await withTimeout(
      loading,
      FFMPEG_INIT_TIMEOUT,
      "FFmpeg initialization timed out. Please reload the page.",
    );
    return ffmpeg!;
  }

  ffmpeg = new FFmpeg();

  loading = (async () => {
    try {
      const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";

      // Time out each file download too
      const [coreURL, wasmURL] = await Promise.all([
        withTimeout(
          toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
          FFMPEG_DOWNLOAD_CORE_TIMEOUT,
          "FFmpeg core download timed out",
        ),
        withTimeout(
          toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
          FFMPEG_DOWNLOAD_WASM_TIMEOUT,
          "FFmpeg WASM download timed out",
        ),
      ]);

      await ffmpeg!.load({ coreURL, wasmURL });
      loaded = true;
    } catch (error) {
      loading = null;
      ffmpeg = null;
      if (error instanceof FFmpegError) throw error;
      throw new FFmpegError("Failed to initialize FFmpeg", error);
    }
  })();

  await loading;
  return ffmpeg;
}

// Get file extension from MIME type
function getExtensionFromMimeType(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
    "video/x-msvideo": "avi",
    "video/x-matroska": "mkv",
    "video/ogg": "ogv",
  };
  return mimeToExt[mimeType] || "mp4";
}

// Get video duration
export async function getVideoDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const objectUrl = URL.createObjectURL(file);
    video.src = objectUrl;
    video.onloadedmetadata = () => {
      const duration = video.duration;
      URL.revokeObjectURL(objectUrl);
      resolve(Math.min(duration, 60));
    };
    video.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(5);
    };
  });
}

// Check if file is video
export function isVideoFile(file: File): boolean {
  return file.type.startsWith("video/");
}

/**
 * Export Canvas to JPEG through FFmpeg
 * Ensures consistent output with video mode
 */
export async function exportCanvasToJpeg(
  canvas: HTMLCanvasElement,
  quality: number = 92,
  onProgress?: (progress: number) => void,
): Promise<Blob> {
  const ff = await initFFmpeg();

  const progressHandler = ({ progress }: { progress: number }) => {
    onProgress?.(progress * 100);
  };
  ff.on("progress", progressHandler);

  try {
    // Convert canvas to PNG blob (lossless intermediate)
    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Failed to create PNG blob"));
      }, "image/png");
    });

    // Write to FFmpeg filesystem
    const pngData = new Uint8Array(await pngBlob.arrayBuffer());
    await ff.writeFile("input.png", pngData);

    // Convert to JPEG with FFmpeg
    await withTimeout(
      ff.exec([
        "-i",
        "input.png",
        "-q:v",
        String(Math.round(((100 - quality) / 100) * 31)), // FFmpeg quality scale (0-31, lower is better)
        "-y",
        "output.jpg",
      ]),
      FFMPEG_TIMEOUT,
      "Image export timed out",
    );

    // Read output
    const data = await ff.readFile("output.jpg");

    // Cleanup
    try {
      await ff.deleteFile("input.png");
    } catch {
      /* ignore */
    }
    try {
      await ff.deleteFile("output.jpg");
    } catch {
      /* ignore */
    }

    const blobData = data instanceof Uint8Array ? new Uint8Array(data) : data;
    return new Blob([blobData], { type: "image/jpeg" });
  } catch (error) {
    if (error instanceof FFmpegError) throw error;
    throw new FFmpegError("Failed to export canvas to JPEG", error);
  } finally {
    ff.off("progress", progressHandler);
  }
}

/**
 * Video transform parameters
 */
export interface VideoTransform {
  scale: number;
  position: { x: number; y: number };
  rotation: number; // Rotation in degrees
  displayScale: number; // The scale factor from canvas to display
}

/**
 * Export Canvas + Video to MP4 through FFmpeg
 * Canvas is overlaid on top of video
 */
export async function exportCanvasWithVideo(
  canvas: HTMLCanvasElement,
  videoFile: File,
  onProgress?: (progress: number) => void,
  videoTransform?: VideoTransform,
): Promise<{ blob: Blob; duration: number }> {
  const ff = await initFFmpeg();

  const progressHandler = ({ progress }: { progress: number }) => {
    onProgress?.(progress * 100);
  };
  ff.on("progress", progressHandler);

  try {
    // Get video duration
    const duration = await getVideoDuration(videoFile);

    // Convert canvas to PNG (for overlay)
    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Failed to create PNG blob"));
      }, "image/png");
    });

    // Write files to FFmpeg filesystem
    const ext = getExtensionFromMimeType(videoFile.type);
    const videoData = await fetchFile(videoFile);
    const pngData = new Uint8Array(await pngBlob.arrayBuffer());

    await ff.writeFile(`input.${ext}`, videoData);
    await ff.writeFile("overlay.png", pngData);

    // Build video filter with transform
    let videoFilter: string;
    const hasTransform =
      videoTransform &&
      (videoTransform.scale !== 1 ||
        videoTransform.position.x !== 0 ||
        videoTransform.position.y !== 0 ||
        videoTransform.rotation !== 0);

    if (hasTransform && videoTransform) {
      // Convert display coordinates to canvas coordinates
      const scale = videoTransform.scale;
      const offsetX = Math.round(
        videoTransform.position.x * videoTransform.displayScale,
      );
      const offsetY = Math.round(
        videoTransform.position.y * videoTransform.displayScale,
      );
      const rotationRad = (videoTransform.rotation * Math.PI) / 180;

      // Calculate scaled video dimensions (larger to accommodate rotation)
      const scaledW = Math.round(CANVAS_WIDTH * scale * 1.5); // Extra space for rotation
      const scaledH = Math.round(CANVAS_HEIGHT * scale * 1.5);

      // Calculate position (centered + offset)
      const posX = Math.round((CANVAS_WIDTH - scaledW) / 2 + offsetX);
      const posY = Math.round((CANVAS_HEIGHT - scaledH) / 2 + offsetY);

      // Scale video, rotate, then position on black background
      if (videoTransform.rotation !== 0) {
        // With rotation: scale -> rotate -> crop -> overlay
        videoFilter = `[0:v]scale=${scaledW}:${scaledH}:force_original_aspect_ratio=increase,crop=${scaledW}:${scaledH},rotate=${rotationRad}:c=black:ow=${scaledW}:oh=${scaledH}[scaled];color=black:s=${CANVAS_WIDTH}x${CANVAS_HEIGHT}[bg];[bg][scaled]overlay=${posX}:${posY}[v];[v][1:v]overlay=0:0[out]`;
      } else {
        // Without rotation: scale -> crop -> overlay
        videoFilter = `[0:v]scale=${scaledW}:${scaledH}:force_original_aspect_ratio=increase,crop=${scaledW}:${scaledH}[scaled];color=black:s=${CANVAS_WIDTH}x${CANVAS_HEIGHT}[bg];[bg][scaled]overlay=${posX}:${posY}[v];[v][1:v]overlay=0:0[out]`;
      }
    } else {
      // Default: scale to fit and center
      videoFilter = `[0:v]scale=${CANVAS_WIDTH}:${CANVAS_HEIGHT}:force_original_aspect_ratio=decrease,pad=${CANVAS_WIDTH}:${CANVAS_HEIGHT}:(ow-iw)/2:(oh-ih)/2[v];[v][1:v]overlay=0:0[out]`;
    }

    // Compose video with canvas overlay
    await withTimeout(
      ff.exec([
        "-i",
        `input.${ext}`,
        "-i",
        "overlay.png",
        "-filter_complex",
        videoFilter,
        "-map",
        "[out]",
        "-map",
        "0:a?",
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "23",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
        "-t",
        "60",
        "-y",
        "output.mp4",
      ]),
      FFMPEG_TIMEOUT * 2,
      "Video export timed out",
    );

    // Read output
    const data = await ff.readFile("output.mp4");

    // Cleanup
    try {
      await ff.deleteFile(`input.${ext}`);
    } catch {
      /* ignore */
    }
    try {
      await ff.deleteFile("overlay.png");
    } catch {
      /* ignore */
    }
    try {
      await ff.deleteFile("output.mp4");
    } catch {
      /* ignore */
    }

    const blobData = data instanceof Uint8Array ? new Uint8Array(data) : data;
    return {
      blob: new Blob([blobData], { type: "video/mp4" }),
      duration: Math.min(duration, 60),
    };
  } catch (error) {
    if (error instanceof FFmpegError) throw error;
    throw new FFmpegError("Failed to export video", error);
  } finally {
    ff.off("progress", progressHandler);
  }
}
