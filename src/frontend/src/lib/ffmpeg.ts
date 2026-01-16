// FFmpeg utility for Story composition
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import type { ImageElement, TextElement, StoryCanvasElement } from '../types';

// Canvas dimensions (9:16 aspect ratio)
const CANVAS_WIDTH = 1080;
const CANVAS_HEIGHT = 1920;

// Timeout constants
const FFMPEG_TIMEOUT = 120000; // 2分（120秒）
const FFMPEG_INIT_TIMEOUT = 60000; // 1分（初期化用）
const FFMPEG_DOWNLOAD_CORE_TIMEOUT = 30000; // 30秒（コアダウンロード用）
const FFMPEG_DOWNLOAD_WASM_TIMEOUT = 60000; // 1分（WASMダウンロード用）

// Timeout utility
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
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
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'FFmpegError';
  }
}

// Initialize FFmpeg
export async function initFFmpeg(): Promise<FFmpeg> {
  if (ffmpeg && loaded) return ffmpeg;

  if (loading) {
    // 初期化待ちにもタイムアウト
    await withTimeout(loading, FFMPEG_INIT_TIMEOUT, 'FFmpegの初期化がタイムアウトしました。ページを再読み込みしてください。');
    return ffmpeg!;
  }

  ffmpeg = new FFmpeg();

  loading = (async () => {
    try {
      const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';

      // 各ファイルのダウンロードにもタイムアウト
      const [coreURL, wasmURL] = await Promise.all([
        withTimeout(
          toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
          FFMPEG_DOWNLOAD_CORE_TIMEOUT,
          'FFmpegコアのダウンロードがタイムアウトしました'
        ),
        withTimeout(
          toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
          FFMPEG_DOWNLOAD_WASM_TIMEOUT,
          'FFmpeg WASMのダウンロードがタイムアウトしました'
        ),
      ]);

      await ffmpeg!.load({ coreURL, wasmURL });
      loaded = true;
    } catch (error) {
      loading = null;
      ffmpeg = null;
      if (error instanceof FFmpegError) throw error;
      throw new FFmpegError('Failed to initialize FFmpeg', error);
    }
  })();

  await loading;
  return ffmpeg;
}

// Render text element to PNG using Canvas (for Japanese font support)
async function renderTextToPng(element: TextElement): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(element.width);
  canvas.height = Math.ceil(element.height);
  const ctx = canvas.getContext('2d')!;

  // Background
  if (element.backgroundColor) {
    ctx.fillStyle = element.backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // Text
  ctx.fillStyle = element.color;
  ctx.font = `${element.fontWeight} ${element.fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Text wrapping
  const words = element.content.split('');
  const lines: string[] = [];
  let currentLine = '';
  const maxWidth = canvas.width - 20;

  for (const char of words) {
    const testLine = currentLine + char;
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = char;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);

  const lineHeight = element.fontSize * 1.2;
  const startY = canvas.height / 2 - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, i) => {
    ctx.fillText(line, canvas.width / 2, startY + i * lineHeight);
  });

  // Convert to PNG blob
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error('Failed to convert canvas to blob'));
    }, 'image/png');
  });

  return new Uint8Array(await blob.arrayBuffer());
}

// Parse gradient and return first color for FFmpeg
function parseBackgroundColor(bg: string): string {
  if (bg.startsWith('linear-gradient')) {
    const match = bg.match(/#[a-fA-F0-9]{6}/);
    return match ? match[0] : '#000000';
  }
  return bg;
}

// Get file extension from MIME type
function getExtensionFromMimeType(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
    'video/x-msvideo': 'avi',
    'video/x-matroska': 'mkv',
    'video/ogg': 'ogv',
  };
  return mimeToExt[mimeType] || 'mp4';
}

// Compose image story using FFmpeg
export async function composeImageStory(
  background: string,
  elements: StoryCanvasElement[],
  onProgress?: (progress: number) => void
): Promise<Blob> {
  const ff = await initFFmpeg();

  // Progress callback with cleanup
  const progressHandler = ({ progress }: { progress: number }) => {
    onProgress?.(progress * 100);
  };
  ff.on('progress', progressHandler);

  try {
    // Sort elements by zIndex and process in order
    const sorted = [...elements].sort((a, b) => a.zIndex - b.zIndex);

    // Prepare all elements with their input files
    const elementInputs: { element: StoryCanvasElement; filename: string; inputIndex: number }[] = [];
    let inputIndex = 0;

    for (let i = 0; i < sorted.length; i++) {
      const el = sorted[i];
      const filename = `element_${i}.png`;

      if (el.type === 'image') {
        const response = await fetch((el as ImageElement).preview);
        const data = await response.arrayBuffer();
        await ff.writeFile(filename, new Uint8Array(data));
      } else if (el.type === 'text') {
        const pngData = await renderTextToPng(el as TextElement);
        await ff.writeFile(filename, pngData);
      }

      elementInputs.push({ element: el, filename, inputIndex });
      inputIndex++;
    }

    // Build FFmpeg filter complex
    const bgColor = parseBackgroundColor(background);
    let filterComplex = `color=c=${bgColor}:s=${CANVAS_WIDTH}x${CANVAS_HEIGHT}:d=1[bg]`;
    let lastOutput = '[bg]';

    // Add overlays in zIndex order
    for (let i = 0; i < elementInputs.length; i++) {
      const { element, inputIndex: idx } = elementInputs[i];
      const x = Math.round(element.x);
      const y = Math.round(element.y);
      const outputLabel = `[v${i}]`;

      if (element.type === 'image') {
        const w = Math.round(element.width);
        const h = Math.round(element.height);
        // Scale input image, then overlay on background
        filterComplex += `;[${idx}:v]scale=${w}:${h}[scaled${i}];${lastOutput}[scaled${i}]overlay=${x}:${y}${outputLabel}`;
      } else {
        // Overlay text PNG on top of current output
        filterComplex += `;${lastOutput}[${idx}:v]overlay=${x}:${y}${outputLabel}`;
      }
      lastOutput = outputLabel;
    }

    // Rename final output to [out]
    if (elements.length === 0) {
      filterComplex = `color=c=${bgColor}:s=${CANVAS_WIDTH}x${CANVAS_HEIGHT}:d=1[out]`;
    } else {
      // Replace last label with [out]
      const escapedLabel = lastOutput.replace(/[[\]]/g, '\\$&');
      filterComplex = filterComplex.replace(new RegExp(`${escapedLabel}$`), '[out]');
    }

    // Build input arguments
    const inputs: string[] = [];
    for (const { filename } of elementInputs) {
      inputs.push('-i', filename);
    }

    // Execute FFmpeg with timeout
    await withTimeout(
      ff.exec([
        ...inputs,
        '-filter_complex', filterComplex,
        '-map', '[out]',
        '-frames:v', '1',
        '-q:v', '2',
        'output.jpg',
      ]),
      FFMPEG_TIMEOUT,
      '画像処理がタイムアウトしました。画像サイズを小さくしてお試しください。'
    );

    // Read output
    const data = await ff.readFile('output.jpg');

    // Cleanup files
    for (const { filename } of elementInputs) {
      try {
        await ff.deleteFile(filename);
      } catch {
        // Ignore cleanup errors
      }
    }
    try {
      await ff.deleteFile('output.jpg');
    } catch {
      // Ignore cleanup errors
    }

    // Convert to regular Uint8Array for Blob compatibility
    const blobData = data instanceof Uint8Array ? new Uint8Array(data) : data;
    return new Blob([blobData], { type: 'image/jpeg' });
  } catch (error) {
    // タイムアウトエラーはそのまま投げる
    if (error instanceof FFmpegError) throw error;
    throw new FFmpegError('Failed to compose image story', error);
  } finally {
    // Always cleanup progress listener
    ff.off('progress', progressHandler);
  }
}

// Compose video story using FFmpeg
export async function composeVideoStory(
  videoFile: File,
  textElements: TextElement[],
  onProgress?: (progress: number) => void
): Promise<{ blob: Blob; duration: number }> {
  const ff = await initFFmpeg();

  // Progress callback with cleanup
  const progressHandler = ({ progress }: { progress: number }) => {
    onProgress?.(progress * 100);
  };
  ff.on('progress', progressHandler);

  try {
    // Determine file extension from MIME type
    const ext = getExtensionFromMimeType(videoFile.type);
    const inputFilename = `input.${ext}`;

    // Write video file
    const videoData = await fetchFile(videoFile);
    await ff.writeFile(inputFilename, videoData);

    // Sort text elements by zIndex
    const sortedText = [...textElements].sort((a, b) => a.zIndex - b.zIndex);

    // Render text elements to PNGs
    const textFiles: string[] = [];
    for (let i = 0; i < sortedText.length; i++) {
      const filename = `text${i}.png`;
      const pngData = await renderTextToPng(sortedText[i]);
      await ff.writeFile(filename, pngData);
      textFiles.push(filename);
    }

    // Build filter complex for video
    let filterComplex = '[0:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2[scaled]';
    let lastOutput = '[scaled]';

    // Add text overlays in zIndex order
    for (let i = 0; i < sortedText.length; i++) {
      const el = sortedText[i];
      const x = Math.round(el.x);
      const y = Math.round(el.y);
      const inputIdx = i + 1;
      const outputLabel = `[t${i}]`;

      // Overlay text PNG on top of video
      filterComplex += `;${lastOutput}[${inputIdx}:v]overlay=${x}:${y}${outputLabel}`;
      lastOutput = outputLabel;
    }

    // Rename final output to [out]
    if (sortedText.length === 0) {
      filterComplex = '[0:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2[out]';
    } else {
      const escapedLabel = lastOutput.replace(/[[\]]/g, '\\$&');
      filterComplex = filterComplex.replace(new RegExp(`${escapedLabel}$`), '[out]');
    }

    // Build input arguments
    const inputs: string[] = ['-i', inputFilename];
    for (const filename of textFiles) {
      inputs.push('-i', filename);
    }

    // Execute FFmpeg with timeout (動画処理は時間がかかるので2倍に設定)
    await withTimeout(
      ff.exec([
        ...inputs,
        '-filter_complex', filterComplex,
        '-map', '[out]',
        '-map', '0:a?',
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '23',
        '-c:a', 'aac',
        '-movflags', '+faststart',
        '-t', '60',  // Max 60 seconds
        'output.mp4',
      ]),
      FFMPEG_TIMEOUT * 2, // 動画は4分
      '動画処理がタイムアウトしました。動画の長さを短くしてお試しください。'
    );

    // Get video duration
    let duration = 5;
    try {
      // Read duration from input video metadata using ffprobe-like approach
      // For now, estimate from file or use default
      const video = document.createElement('video');
      video.src = URL.createObjectURL(videoFile);
      await new Promise<void>((resolve) => {
        video.onloadedmetadata = () => {
          duration = Math.min(video.duration, 60);
          URL.revokeObjectURL(video.src);
          resolve();
        };
        video.onerror = () => resolve();
      });
    } catch {
      // Use default
    }

    // Read output
    const data = await ff.readFile('output.mp4');

    // Cleanup files
    try {
      await ff.deleteFile(inputFilename);
    } catch {
      // Ignore cleanup errors
    }
    for (const filename of textFiles) {
      try {
        await ff.deleteFile(filename);
      } catch {
        // Ignore cleanup errors
      }
    }
    try {
      await ff.deleteFile('output.mp4');
    } catch {
      // Ignore cleanup errors
    }

    // Convert to regular Uint8Array for Blob compatibility
    const blobData = data instanceof Uint8Array ? new Uint8Array(data) : data;
    return {
      blob: new Blob([blobData], { type: 'video/mp4' }),
      duration,
    };
  } catch (error) {
    // タイムアウトエラーはそのまま投げる
    if (error instanceof FFmpegError) throw error;
    throw new FFmpegError('Failed to compose video story', error);
  } finally {
    // Always cleanup progress listener
    ff.off('progress', progressHandler);
  }
}

// Get video duration
export async function getVideoDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.src = URL.createObjectURL(file);
    video.onloadedmetadata = () => {
      const duration = video.duration;
      URL.revokeObjectURL(video.src);
      resolve(Math.min(duration, 60));
    };
    video.onerror = () => resolve(5);
  });
}

// Check if file is video
export function isVideoFile(file: File): boolean {
  return file.type.startsWith('video/');
}

// Check if file is image
export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

/**
 * Export Canvas to JPEG through FFmpeg
 * Ensures consistent output with video mode
 */
export async function exportCanvasToJpeg(
  canvas: HTMLCanvasElement,
  quality: number = 92,
  onProgress?: (progress: number) => void
): Promise<Blob> {
  const ff = await initFFmpeg();

  const progressHandler = ({ progress }: { progress: number }) => {
    onProgress?.(progress * 100);
  };
  ff.on('progress', progressHandler);

  try {
    // Convert canvas to PNG blob (lossless intermediate)
    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Failed to create PNG blob'));
        },
        'image/png'
      );
    });

    // Write to FFmpeg filesystem
    const pngData = new Uint8Array(await pngBlob.arrayBuffer());
    await ff.writeFile('input.png', pngData);

    // Convert to JPEG with FFmpeg
    await withTimeout(
      ff.exec([
        '-i', 'input.png',
        '-q:v', String(Math.round((100 - quality) / 100 * 31)), // FFmpeg quality scale (0-31, lower is better)
        '-y',
        'output.jpg',
      ]),
      FFMPEG_TIMEOUT,
      '画像のエクスポートがタイムアウトしました'
    );

    // Read output
    const data = await ff.readFile('output.jpg');

    // Cleanup
    try { await ff.deleteFile('input.png'); } catch { /* ignore */ }
    try { await ff.deleteFile('output.jpg'); } catch { /* ignore */ }

    const blobData = data instanceof Uint8Array ? new Uint8Array(data) : data;
    return new Blob([blobData], { type: 'image/jpeg' });
  } catch (error) {
    if (error instanceof FFmpegError) throw error;
    throw new FFmpegError('Failed to export canvas to JPEG', error);
  } finally {
    ff.off('progress', progressHandler);
  }
}

/**
 * Video transform parameters
 */
export interface VideoTransform {
  scale: number;
  position: { x: number; y: number };
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
  videoTransform?: VideoTransform
): Promise<{ blob: Blob; duration: number }> {
  const ff = await initFFmpeg();

  const progressHandler = ({ progress }: { progress: number }) => {
    onProgress?.(progress * 100);
  };
  ff.on('progress', progressHandler);

  try {
    // Get video duration
    const duration = await getVideoDuration(videoFile);

    // Convert canvas to PNG (for overlay)
    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Failed to create PNG blob'));
        },
        'image/png'
      );
    });

    // Write files to FFmpeg filesystem
    const ext = getExtensionFromMimeType(videoFile.type);
    const videoData = await fetchFile(videoFile);
    const pngData = new Uint8Array(await pngBlob.arrayBuffer());

    await ff.writeFile(`input.${ext}`, videoData);
    await ff.writeFile('overlay.png', pngData);

    // Build video filter with transform
    let videoFilter: string;
    if (videoTransform && (videoTransform.scale !== 1 || videoTransform.position.x !== 0 || videoTransform.position.y !== 0)) {
      // Convert display coordinates to canvas coordinates
      const scale = videoTransform.scale;
      const offsetX = Math.round(videoTransform.position.x * videoTransform.displayScale);
      const offsetY = Math.round(videoTransform.position.y * videoTransform.displayScale);

      // Calculate scaled video dimensions
      const scaledW = Math.round(CANVAS_WIDTH * scale);
      const scaledH = Math.round(CANVAS_HEIGHT * scale);

      // Calculate position (centered + offset)
      const posX = Math.round((CANVAS_WIDTH - scaledW) / 2 + offsetX);
      const posY = Math.round((CANVAS_HEIGHT - scaledH) / 2 + offsetY);

      // Scale video to fill, then scale again by user transform, position on black background
      videoFilter = `[0:v]scale=${scaledW}:${scaledH}:force_original_aspect_ratio=increase,crop=${scaledW}:${scaledH}[scaled];color=black:s=${CANVAS_WIDTH}x${CANVAS_HEIGHT}[bg];[bg][scaled]overlay=${posX}:${posY}[v];[v][1:v]overlay=0:0[out]`;
    } else {
      // Default: scale to fit and center
      videoFilter = `[0:v]scale=${CANVAS_WIDTH}:${CANVAS_HEIGHT}:force_original_aspect_ratio=decrease,pad=${CANVAS_WIDTH}:${CANVAS_HEIGHT}:(ow-iw)/2:(oh-ih)/2[v];[v][1:v]overlay=0:0[out]`;
    }

    // Compose video with canvas overlay
    await withTimeout(
      ff.exec([
        '-i', `input.${ext}`,
        '-i', 'overlay.png',
        '-filter_complex', videoFilter,
        '-map', '[out]',
        '-map', '0:a?',
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '23',
        '-c:a', 'aac',
        '-movflags', '+faststart',
        '-t', '60',
        '-y',
        'output.mp4',
      ]),
      FFMPEG_TIMEOUT * 2,
      '動画のエクスポートがタイムアウトしました'
    );

    // Read output
    const data = await ff.readFile('output.mp4');

    // Cleanup
    try { await ff.deleteFile(`input.${ext}`); } catch { /* ignore */ }
    try { await ff.deleteFile('overlay.png'); } catch { /* ignore */ }
    try { await ff.deleteFile('output.mp4'); } catch { /* ignore */ }

    const blobData = data instanceof Uint8Array ? new Uint8Array(data) : data;
    return {
      blob: new Blob([blobData], { type: 'video/mp4' }),
      duration: Math.min(duration, 60),
    };
  } catch (error) {
    if (error instanceof FFmpegError) throw error;
    throw new FFmpegError('Failed to export video', error);
  } finally {
    ff.off('progress', progressHandler);
  }
}
