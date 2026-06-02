/**
 * Story Canvas Engine
 *
 * Canvas-first rendering for WYSIWYG story editing.
 * Single source of truth for both preview and export.
 *
 * Drawing logic is in story-canvas-drawing.ts
 * Transform/hit-test logic is in story-canvas-transforms.ts
 */

import {
  drawBackground,
  drawDrawing,
  drawMedia,
  drawSticker,
  drawText,
} from "./story-canvas-drawing.ts";
import {
  getLayerCorners as getLayerCornersImpl,
  hitTest as hitTestImpl,
} from "./story-canvas-transforms.ts";

// Canvas dimensions (9:16 aspect ratio, Instagram story size)
export const CANVAS_WIDTH = 1080;
export const CANVAS_HEIGHT = 1920;

// Layer types
type LayerType = "background" | "media" | "text" | "sticker" | "drawing";

// Base layer interface
export interface BaseLayer {
  id: string;
  type: LayerType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  zIndex: number;
  visible: boolean;
  locked: boolean;
}

// Background layer
export interface BackgroundLayer extends BaseLayer {
  type: "background";
  fill: BackgroundFill;
}

export type BackgroundFill =
  | { type: "solid"; color: string }
  | { type: "gradient"; colors: string[]; angle: number }
  | { type: "image"; src: string }
  | { type: "transparent" };

// Media layer (images)
export interface MediaLayer extends BaseLayer {
  type: "media";
  src: string; // blob URL or data URL
  originalWidth: number;
  originalHeight: number;
  filter?: ImageFilter;
  cropRect?: { x: number; y: number; width: number; height: number };
}

// Image filters
export interface ImageFilter {
  brightness: number; // 0-200, default 100
  contrast: number; // 0-200, default 100
  saturation: number; // 0-200, default 100
  blur: number; // 0-20, default 0
  sepia: number; // 0-100, default 0
  grayscale: number; // 0-100, default 0
  hueRotate: number; // 0-360, default 0
}

// Text layer
export interface TextLayer extends BaseLayer {
  type: "text";
  content: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: "normal" | "bold";
  fontStyle: "normal" | "italic";
  color: string;
  backgroundColor?: string;
  backgroundPadding: number;
  backgroundRadius: number;
  textAlign: "left" | "center" | "right";
  lineHeight: number;
  letterSpacing: number;
  stroke?: { color: string; width: number };
  shadow?: { color: string; blur: number; offsetX: number; offsetY: number };
}

// Sticker layer (emoji, images, etc.)
export interface StickerLayer extends BaseLayer {
  type: "sticker";
  src: string; // emoji character or image URL
  isEmoji: boolean;
}

// Drawing layer (freehand)
export interface DrawingLayer extends BaseLayer {
  type: "drawing";
  paths: DrawingPath[];
}

export interface DrawingPath {
  points: { x: number; y: number }[];
  color: string;
  width: number;
  opacity: number;
}

// Union type for all layers
export type Layer =
  | BackgroundLayer
  | MediaLayer
  | TextLayer
  | StickerLayer
  | DrawingLayer;

// Available fonts
export const FONTS = [
  {
    id: "sans",
    name: "ゴシック",
    family: '"Hiragino Sans", "Noto Sans JP", sans-serif',
  },
  {
    id: "serif",
    name: "明朝",
    family: '"Hiragino Mincho ProN", "Noto Serif JP", serif',
  },
  {
    id: "rounded",
    name: "丸ゴシック",
    family: '"Hiragino Maru Gothic ProN", "M PLUS Rounded 1c", sans-serif',
  },
  {
    id: "handwriting",
    name: "手書き",
    family: '"Zen Kurenaido", "Klee One", cursive',
  },
  {
    id: "pop",
    name: "ポップ",
    family: '"Kosugi Maru", "M PLUS Rounded 1c", sans-serif',
  },
  {
    id: "mono",
    name: "等幅",
    family: '"Source Code Pro", "Noto Sans Mono", monospace',
  },
];

// Filter presets
export const FILTER_PRESETS: {
  id: string;
  name: string;
  filter: ImageFilter;
}[] = [
  {
    id: "none",
    name: "なし",
    filter: {
      brightness: 100,
      contrast: 100,
      saturation: 100,
      blur: 0,
      sepia: 0,
      grayscale: 0,
      hueRotate: 0,
    },
  },
  {
    id: "vivid",
    name: "ビビッド",
    filter: {
      brightness: 105,
      contrast: 110,
      saturation: 130,
      blur: 0,
      sepia: 0,
      grayscale: 0,
      hueRotate: 0,
    },
  },
  {
    id: "warm",
    name: "暖色",
    filter: {
      brightness: 105,
      contrast: 100,
      saturation: 110,
      blur: 0,
      sepia: 20,
      grayscale: 0,
      hueRotate: 0,
    },
  },
  {
    id: "cool",
    name: "寒色",
    filter: {
      brightness: 100,
      contrast: 105,
      saturation: 90,
      blur: 0,
      sepia: 0,
      grayscale: 0,
      hueRotate: 180,
    },
  },
  {
    id: "vintage",
    name: "ヴィンテージ",
    filter: {
      brightness: 110,
      contrast: 85,
      saturation: 80,
      blur: 0,
      sepia: 30,
      grayscale: 0,
      hueRotate: 0,
    },
  },
  {
    id: "bw",
    name: "モノクロ",
    filter: {
      brightness: 100,
      contrast: 110,
      saturation: 0,
      blur: 0,
      sepia: 0,
      grayscale: 100,
      hueRotate: 0,
    },
  },
  {
    id: "fade",
    name: "フェード",
    filter: {
      brightness: 110,
      contrast: 90,
      saturation: 80,
      blur: 0,
      sepia: 10,
      grayscale: 0,
      hueRotate: 0,
    },
  },
  {
    id: "dramatic",
    name: "ドラマチック",
    filter: {
      brightness: 95,
      contrast: 130,
      saturation: 110,
      blur: 0,
      sepia: 0,
      grayscale: 0,
      hueRotate: 0,
    },
  },
];

// Generate unique ID
function generateLayerId(): string {
  return `layer_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Story Canvas class
 * Manages all layers and rendering
 */
export class StoryCanvas {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private layers: Layer[] = [];
  private imageCache: Map<string, HTMLImageElement> = new Map();
  private fontsLoaded: Set<string> = new Set();

  constructor(canvas?: HTMLCanvasElement) {
    if (canvas) {
      this.canvas = canvas;
    } else {
      this.canvas = document.createElement("canvas");
    }
    this.canvas.width = CANVAS_WIDTH;
    this.canvas.height = CANVAS_HEIGHT;
    this.ctx = this.canvas.getContext("2d")!;

    // Initialize with default background
    this.layers = [
      {
        id: "background",
        type: "background",
        x: 0,
        y: 0,
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        rotation: 0,
        opacity: 1,
        zIndex: 0,
        visible: true,
        locked: true,
        fill: { type: "solid", color: "#000000" },
      },
    ];
  }

  // Get the canvas element
  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  // Get all layers
  getLayers(): Layer[] {
    return [...this.layers];
  }

  // Get layer by ID
  getLayer(id: string): Layer | undefined {
    return this.layers.find((l) => l.id === id);
  }

  // Add layer
  addLayer(layer: Omit<Layer, "id" | "zIndex"> & { id?: string }): Layer {
    const maxZIndex = Math.max(0, ...this.layers.map((l) => l.zIndex));
    const newLayer = {
      ...layer,
      id: layer.id || generateLayerId(),
      zIndex: maxZIndex + 1,
    } as Layer;
    this.layers.push(newLayer);
    return newLayer;
  }

  // Update layer
  updateLayer(id: string, updates: Partial<Layer>): void {
    const index = this.layers.findIndex((l) => l.id === id);
    if (index !== -1) {
      this.layers[index] = { ...this.layers[index], ...updates } as Layer;
    }
  }

  // Remove layer
  removeLayer(id: string): void {
    this.layers = this.layers.filter((l) => l.id !== id);
  }

  // Move layer to front
  bringToFront(id: string): void {
    const maxZIndex = Math.max(...this.layers.map((l) => l.zIndex));
    this.updateLayer(id, { zIndex: maxZIndex + 1 });
  }

  // Move layer to back
  sendToBack(id: string): void {
    const minZIndex = Math.min(
      ...this.layers
        .filter((l) => l.type !== "background")
        .map((l) => l.zIndex),
    );
    this.updateLayer(id, { zIndex: minZIndex - 1 });
  }

  // Set background
  setBackground(fill: BackgroundFill): void {
    const bgLayer = this.layers.find(
      (l) => l.type === "background",
    ) as BackgroundLayer;
    if (bgLayer) {
      bgLayer.fill = fill;
    }
  }

  // Load image and cache it
  async loadImage(src: string): Promise<HTMLImageElement> {
    if (this.imageCache.has(src)) {
      return this.imageCache.get(src)!;
    }

    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        this.imageCache.set(src, img);
        resolve(img);
      };
      img.onerror = reject;
      img.src = src;
    });
  }

  // Load font
  async loadFont(family: string): Promise<void> {
    if (this.fontsLoaded.has(family)) return;

    try {
      await document.fonts.load(`16px ${family}`);
      this.fontsLoaded.add(family);
    } catch (e) {
      console.warn(`Failed to load font: ${family}`, e);
    }
  }

  // Render all layers
  async render(): Promise<void> {
    // Clear canvas
    this.ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Sort layers by zIndex
    const sortedLayers = [...this.layers].sort((a, b) => a.zIndex - b.zIndex);

    // Draw each layer
    for (const layer of sortedLayers) {
      if (!layer.visible) continue;

      switch (layer.type) {
        case "background":
          drawBackground(this.ctx, layer, this.imageCache);
          break;
        case "media":
          drawMedia(this.ctx, layer, this.imageCache);
          break;
        case "text":
          drawText(this.ctx, layer);
          break;
        case "sticker":
          drawSticker(this.ctx, layer, this.imageCache);
          break;
        case "drawing":
          drawDrawing(this.ctx, layer);
          break;
      }
    }
  }

  // Export to blob
  async toBlob(
    type: "image/jpeg" | "image/png" = "image/jpeg",
    quality = 0.92,
  ): Promise<Blob> {
    await this.render();

    return new Promise((resolve, reject) => {
      this.canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error("Failed to create blob"));
        },
        type,
        quality,
      );
    });
  }

  // Export to data URL
  async toDataURL(
    type: "image/jpeg" | "image/png" = "image/jpeg",
    quality = 0.92,
  ): Promise<string> {
    await this.render();
    return this.canvas.toDataURL(type, quality);
  }

  // Hit test - find layer at point
  hitTest(x: number, y: number): Layer | null {
    return hitTestImpl(this.layers, x, y);
  }

  // Get bounding box corners for a layer (for resize handles)
  getLayerCorners(layer: Layer): { x: number; y: number }[] {
    return getLayerCornersImpl(layer);
  }

  // Create default text layer
  createTextLayer(content: string = "テキスト"): TextLayer {
    return {
      id: generateLayerId(),
      type: "text",
      x: CANVAS_WIDTH / 2 - 300,
      y: CANVAS_HEIGHT / 2 - 100,
      width: 600,
      height: 200,
      rotation: 0,
      opacity: 1,
      zIndex: 0,
      visible: true,
      locked: false,
      content,
      fontFamily: FONTS[0].family,
      fontSize: 64,
      fontWeight: "bold",
      fontStyle: "normal",
      color: "#ffffff",
      backgroundColor: "rgba(0,0,0,0.5)",
      backgroundPadding: 16,
      backgroundRadius: 12,
      textAlign: "center",
      lineHeight: 1.3,
      letterSpacing: 0,
    };
  }

  // Create media layer from image
  async createMediaLayer(src: string): Promise<MediaLayer> {
    const img = await this.loadImage(src);

    // Calculate size to fit in canvas while maintaining aspect ratio
    const maxSize = Math.min(CANVAS_WIDTH, CANVAS_HEIGHT) * 0.8;
    const scale = Math.min(maxSize / img.width, maxSize / img.height);
    const width = img.width * scale;
    const height = img.height * scale;

    return {
      id: generateLayerId(),
      type: "media",
      x: (CANVAS_WIDTH - width) / 2,
      y: (CANVAS_HEIGHT - height) / 2,
      width,
      height,
      rotation: 0,
      opacity: 1,
      zIndex: 0,
      visible: true,
      locked: false,
      src,
      originalWidth: img.width,
      originalHeight: img.height,
    };
  }

  // Create sticker layer
  createStickerLayer(src: string, isEmoji: boolean): StickerLayer {
    const size = isEmoji ? 150 : 200;
    return {
      id: generateLayerId(),
      type: "sticker",
      x: CANVAS_WIDTH / 2 - size / 2,
      y: CANVAS_HEIGHT / 2 - size / 2,
      width: size,
      height: size,
      rotation: 0,
      opacity: 1,
      zIndex: 0,
      visible: true,
      locked: false,
      src,
      isEmoji,
    };
  }

  // Create drawing layer
  createDrawingLayer(): DrawingLayer {
    return {
      id: generateLayerId(),
      type: "drawing",
      x: 0,
      y: 0,
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      rotation: 0,
      opacity: 1,
      zIndex: 0,
      visible: true,
      locked: false,
      paths: [],
    };
  }

  // Serialize state for saving
  serialize(): string {
    return JSON.stringify({
      version: 1,
      layers: this.layers,
    });
  }

  // Deserialize state
  deserialize(data: string): void {
    try {
      const parsed = JSON.parse(data);
      if (parsed.version === 1 && Array.isArray(parsed.layers)) {
        this.layers = parsed.layers;
      }
    } catch (e) {
      console.error("Failed to deserialize canvas state:", e);
    }
  }
}
