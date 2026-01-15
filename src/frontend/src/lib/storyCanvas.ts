/**
 * Story Canvas Engine
 *
 * Canvas-first rendering for WYSIWYG story editing.
 * Single source of truth for both preview and export.
 */

// Canvas dimensions (9:16 aspect ratio, Instagram story size)
export const CANVAS_WIDTH = 1080;
export const CANVAS_HEIGHT = 1920;

// Layer types
export type LayerType = 'background' | 'media' | 'text' | 'sticker' | 'drawing';

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
  type: 'background';
  fill: BackgroundFill;
}

export type BackgroundFill =
  | { type: 'solid'; color: string }
  | { type: 'gradient'; colors: string[]; angle: number }
  | { type: 'image'; src: string };

// Media layer (images)
export interface MediaLayer extends BaseLayer {
  type: 'media';
  src: string;           // blob URL or data URL
  originalWidth: number;
  originalHeight: number;
  filter?: ImageFilter;
  cropRect?: { x: number; y: number; width: number; height: number };
}

// Image filters
export interface ImageFilter {
  brightness: number;    // 0-200, default 100
  contrast: number;      // 0-200, default 100
  saturation: number;    // 0-200, default 100
  blur: number;          // 0-20, default 0
  sepia: number;         // 0-100, default 0
  grayscale: number;     // 0-100, default 0
  hueRotate: number;     // 0-360, default 0
}

// Text layer
export interface TextLayer extends BaseLayer {
  type: 'text';
  content: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: 'normal' | 'bold';
  fontStyle: 'normal' | 'italic';
  color: string;
  backgroundColor?: string;
  backgroundPadding: number;
  backgroundRadius: number;
  textAlign: 'left' | 'center' | 'right';
  lineHeight: number;
  letterSpacing: number;
  stroke?: { color: string; width: number };
  shadow?: { color: string; blur: number; offsetX: number; offsetY: number };
}

// Sticker layer (emoji, images, etc.)
export interface StickerLayer extends BaseLayer {
  type: 'sticker';
  src: string;           // emoji character or image URL
  isEmoji: boolean;
}

// Drawing layer (freehand)
export interface DrawingLayer extends BaseLayer {
  type: 'drawing';
  paths: DrawingPath[];
}

export interface DrawingPath {
  points: { x: number; y: number }[];
  color: string;
  width: number;
  opacity: number;
}

// Union type for all layers
export type Layer = BackgroundLayer | MediaLayer | TextLayer | StickerLayer | DrawingLayer;

// Available fonts
export const FONTS = [
  { id: 'sans', name: 'ゴシック', family: '"Hiragino Sans", "Noto Sans JP", sans-serif' },
  { id: 'serif', name: '明朝', family: '"Hiragino Mincho ProN", "Noto Serif JP", serif' },
  { id: 'rounded', name: '丸ゴシック', family: '"Hiragino Maru Gothic ProN", "M PLUS Rounded 1c", sans-serif' },
  { id: 'handwriting', name: '手書き', family: '"Zen Kurenaido", "Klee One", cursive' },
  { id: 'pop', name: 'ポップ', family: '"Kosugi Maru", "M PLUS Rounded 1c", sans-serif' },
  { id: 'mono', name: '等幅', family: '"Source Code Pro", "Noto Sans Mono", monospace' },
];

// Filter presets
export const FILTER_PRESETS: { id: string; name: string; filter: ImageFilter }[] = [
  { id: 'none', name: 'なし', filter: { brightness: 100, contrast: 100, saturation: 100, blur: 0, sepia: 0, grayscale: 0, hueRotate: 0 } },
  { id: 'vivid', name: 'ビビッド', filter: { brightness: 105, contrast: 110, saturation: 130, blur: 0, sepia: 0, grayscale: 0, hueRotate: 0 } },
  { id: 'warm', name: '暖色', filter: { brightness: 105, contrast: 100, saturation: 110, blur: 0, sepia: 20, grayscale: 0, hueRotate: 0 } },
  { id: 'cool', name: '寒色', filter: { brightness: 100, contrast: 105, saturation: 90, blur: 0, sepia: 0, grayscale: 0, hueRotate: 180 } },
  { id: 'vintage', name: 'ヴィンテージ', filter: { brightness: 110, contrast: 85, saturation: 80, blur: 0, sepia: 30, grayscale: 0, hueRotate: 0 } },
  { id: 'bw', name: 'モノクロ', filter: { brightness: 100, contrast: 110, saturation: 0, blur: 0, sepia: 0, grayscale: 100, hueRotate: 0 } },
  { id: 'fade', name: 'フェード', filter: { brightness: 110, contrast: 90, saturation: 80, blur: 0, sepia: 10, grayscale: 0, hueRotate: 0 } },
  { id: 'dramatic', name: 'ドラマチック', filter: { brightness: 95, contrast: 130, saturation: 110, blur: 0, sepia: 0, grayscale: 0, hueRotate: 0 } },
];

// Generate unique ID
export function generateLayerId(): string {
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
      this.canvas = document.createElement('canvas');
    }
    this.canvas.width = CANVAS_WIDTH;
    this.canvas.height = CANVAS_HEIGHT;
    this.ctx = this.canvas.getContext('2d')!;

    // Initialize with default background
    this.layers = [{
      id: 'background',
      type: 'background',
      x: 0,
      y: 0,
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      rotation: 0,
      opacity: 1,
      zIndex: 0,
      visible: true,
      locked: true,
      fill: { type: 'solid', color: '#000000' },
    }];
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
    return this.layers.find(l => l.id === id);
  }

  // Add layer
  addLayer(layer: Omit<Layer, 'id' | 'zIndex'> & { id?: string }): Layer {
    const maxZIndex = Math.max(0, ...this.layers.map(l => l.zIndex));
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
    const index = this.layers.findIndex(l => l.id === id);
    if (index !== -1) {
      this.layers[index] = { ...this.layers[index], ...updates } as Layer;
    }
  }

  // Remove layer
  removeLayer(id: string): void {
    this.layers = this.layers.filter(l => l.id !== id);
  }

  // Move layer to front
  bringToFront(id: string): void {
    const maxZIndex = Math.max(...this.layers.map(l => l.zIndex));
    this.updateLayer(id, { zIndex: maxZIndex + 1 });
  }

  // Move layer to back
  sendToBack(id: string): void {
    const minZIndex = Math.min(...this.layers.filter(l => l.type !== 'background').map(l => l.zIndex));
    this.updateLayer(id, { zIndex: minZIndex - 1 });
  }

  // Set background
  setBackground(fill: BackgroundFill): void {
    const bgLayer = this.layers.find(l => l.type === 'background') as BackgroundLayer;
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
      img.crossOrigin = 'anonymous';
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

  // Get CSS filter string from ImageFilter
  private getFilterString(filter: ImageFilter): string {
    const parts: string[] = [];
    if (filter.brightness !== 100) parts.push(`brightness(${filter.brightness}%)`);
    if (filter.contrast !== 100) parts.push(`contrast(${filter.contrast}%)`);
    if (filter.saturation !== 100) parts.push(`saturate(${filter.saturation}%)`);
    if (filter.blur > 0) parts.push(`blur(${filter.blur}px)`);
    if (filter.sepia > 0) parts.push(`sepia(${filter.sepia}%)`);
    if (filter.grayscale > 0) parts.push(`grayscale(${filter.grayscale}%)`);
    if (filter.hueRotate !== 0) parts.push(`hue-rotate(${filter.hueRotate}deg)`);
    return parts.join(' ') || 'none';
  }

  // Draw background
  private drawBackground(layer: BackgroundLayer): void {
    const { fill } = layer;

    if (fill.type === 'solid') {
      this.ctx.fillStyle = fill.color;
      this.ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    } else if (fill.type === 'gradient') {
      const radians = (fill.angle * Math.PI) / 180;
      const x1 = CANVAS_WIDTH / 2 - Math.cos(radians) * CANVAS_WIDTH;
      const y1 = CANVAS_HEIGHT / 2 - Math.sin(radians) * CANVAS_HEIGHT;
      const x2 = CANVAS_WIDTH / 2 + Math.cos(radians) * CANVAS_WIDTH;
      const y2 = CANVAS_HEIGHT / 2 + Math.sin(radians) * CANVAS_HEIGHT;

      const gradient = this.ctx.createLinearGradient(x1, y1, x2, y2);
      fill.colors.forEach((color, i) => {
        gradient.addColorStop(i / (fill.colors.length - 1), color);
      });

      this.ctx.fillStyle = gradient;
      this.ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    } else if (fill.type === 'image') {
      const img = this.imageCache.get(fill.src);
      if (img) {
        // Cover the canvas
        const scale = Math.max(CANVAS_WIDTH / img.width, CANVAS_HEIGHT / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        const x = (CANVAS_WIDTH - w) / 2;
        const y = (CANVAS_HEIGHT - h) / 2;
        this.ctx.drawImage(img, x, y, w, h);
      }
    }
  }

  // Draw media layer
  private drawMedia(layer: MediaLayer): void {
    const img = this.imageCache.get(layer.src);
    if (!img) return;

    this.ctx.save();

    // Apply transform
    this.ctx.translate(layer.x + layer.width / 2, layer.y + layer.height / 2);
    this.ctx.rotate((layer.rotation * Math.PI) / 180);
    this.ctx.globalAlpha = layer.opacity;

    // Apply filter
    if (layer.filter) {
      this.ctx.filter = this.getFilterString(layer.filter);
    }

    // Draw image
    this.ctx.drawImage(
      img,
      -layer.width / 2,
      -layer.height / 2,
      layer.width,
      layer.height
    );

    this.ctx.restore();
  }

  // Draw text layer
  private drawText(layer: TextLayer): void {
    this.ctx.save();

    // Apply transform
    this.ctx.translate(layer.x + layer.width / 2, layer.y + layer.height / 2);
    this.ctx.rotate((layer.rotation * Math.PI) / 180);
    this.ctx.globalAlpha = layer.opacity;

    // Draw background if set
    if (layer.backgroundColor) {
      this.ctx.fillStyle = layer.backgroundColor;
      const padding = layer.backgroundPadding;
      const radius = layer.backgroundRadius;

      this.roundRect(
        -layer.width / 2 - padding,
        -layer.height / 2 - padding,
        layer.width + padding * 2,
        layer.height + padding * 2,
        radius
      );
      this.ctx.fill();
    }

    // Set text style
    const fontStyle = layer.fontStyle === 'italic' ? 'italic ' : '';
    const fontWeight = layer.fontWeight === 'bold' ? 'bold ' : '';
    this.ctx.font = `${fontStyle}${fontWeight}${layer.fontSize}px ${layer.fontFamily}`;
    this.ctx.textAlign = layer.textAlign;
    this.ctx.textBaseline = 'top';

    // Calculate text metrics and wrap
    const lines = this.wrapText(layer.content, layer.width, layer.letterSpacing);
    const lineHeight = layer.fontSize * layer.lineHeight;
    const totalHeight = lines.length * lineHeight;
    const startY = -totalHeight / 2;

    // Calculate X based on alignment
    let textX = 0;
    if (layer.textAlign === 'left') textX = -layer.width / 2;
    else if (layer.textAlign === 'right') textX = layer.width / 2;

    // Draw each line
    lines.forEach((line, i) => {
      const y = startY + i * lineHeight;

      // Draw shadow if set
      if (layer.shadow) {
        this.ctx.save();
        this.ctx.shadowColor = layer.shadow.color;
        this.ctx.shadowBlur = layer.shadow.blur;
        this.ctx.shadowOffsetX = layer.shadow.offsetX;
        this.ctx.shadowOffsetY = layer.shadow.offsetY;
        this.ctx.fillStyle = layer.color;
        this.drawTextLine(line, textX, y, layer.letterSpacing);
        this.ctx.restore();
      }

      // Draw stroke if set
      if (layer.stroke) {
        this.ctx.strokeStyle = layer.stroke.color;
        this.ctx.lineWidth = layer.stroke.width;
        this.ctx.lineJoin = 'round';
        this.strokeTextLine(line, textX, y, layer.letterSpacing);
      }

      // Draw text
      this.ctx.fillStyle = layer.color;
      this.drawTextLine(line, textX, y, layer.letterSpacing);
    });

    this.ctx.restore();
  }

  // Draw text with letter spacing
  private drawTextLine(text: string, x: number, y: number, letterSpacing: number): void {
    if (letterSpacing === 0) {
      this.ctx.fillText(text, x, y);
    } else {
      const chars = [...text];
      let currentX = x;

      // Adjust starting position for center/right alignment
      if (this.ctx.textAlign === 'center') {
        const totalWidth = this.measureTextWithSpacing(text, letterSpacing);
        currentX = x - totalWidth / 2;
        this.ctx.textAlign = 'left';
      } else if (this.ctx.textAlign === 'right') {
        const totalWidth = this.measureTextWithSpacing(text, letterSpacing);
        currentX = x - totalWidth;
        this.ctx.textAlign = 'left';
      }

      chars.forEach(char => {
        this.ctx.fillText(char, currentX, y);
        currentX += this.ctx.measureText(char).width + letterSpacing;
      });
    }
  }

  // Stroke text with letter spacing
  private strokeTextLine(text: string, x: number, y: number, letterSpacing: number): void {
    if (letterSpacing === 0) {
      this.ctx.strokeText(text, x, y);
    } else {
      const chars = [...text];
      let currentX = x;

      if (this.ctx.textAlign === 'center') {
        const totalWidth = this.measureTextWithSpacing(text, letterSpacing);
        currentX = x - totalWidth / 2;
      } else if (this.ctx.textAlign === 'right') {
        const totalWidth = this.measureTextWithSpacing(text, letterSpacing);
        currentX = x - totalWidth;
      }

      const savedAlign = this.ctx.textAlign;
      this.ctx.textAlign = 'left';

      chars.forEach(char => {
        this.ctx.strokeText(char, currentX, y);
        currentX += this.ctx.measureText(char).width + letterSpacing;
      });

      this.ctx.textAlign = savedAlign;
    }
  }

  // Measure text width with letter spacing
  private measureTextWithSpacing(text: string, letterSpacing: number): number {
    const chars = [...text];
    let width = 0;
    chars.forEach((char, i) => {
      width += this.ctx.measureText(char).width;
      if (i < chars.length - 1) width += letterSpacing;
    });
    return width;
  }

  // Wrap text to fit width
  private wrapText(text: string, maxWidth: number, letterSpacing: number): string[] {
    const lines: string[] = [];
    const paragraphs = text.split('\n');

    paragraphs.forEach(paragraph => {
      if (paragraph === '') {
        lines.push('');
        return;
      }

      const chars = [...paragraph];
      let currentLine = '';

      chars.forEach(char => {
        const testLine = currentLine + char;
        const testWidth = letterSpacing === 0
          ? this.ctx.measureText(testLine).width
          : this.measureTextWithSpacing(testLine, letterSpacing);

        if (testWidth > maxWidth && currentLine !== '') {
          lines.push(currentLine);
          currentLine = char;
        } else {
          currentLine = testLine;
        }
      });

      if (currentLine) {
        lines.push(currentLine);
      }
    });

    return lines.length > 0 ? lines : [''];
  }

  // Draw rounded rectangle
  private roundRect(x: number, y: number, w: number, h: number, r: number): void {
    if (r === 0) {
      this.ctx.rect(x, y, w, h);
      return;
    }

    this.ctx.beginPath();
    this.ctx.moveTo(x + r, y);
    this.ctx.lineTo(x + w - r, y);
    this.ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    this.ctx.lineTo(x + w, y + h - r);
    this.ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    this.ctx.lineTo(x + r, y + h);
    this.ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    this.ctx.lineTo(x, y + r);
    this.ctx.quadraticCurveTo(x, y, x + r, y);
    this.ctx.closePath();
  }

  // Draw sticker layer
  private drawSticker(layer: StickerLayer): void {
    this.ctx.save();

    this.ctx.translate(layer.x + layer.width / 2, layer.y + layer.height / 2);
    this.ctx.rotate((layer.rotation * Math.PI) / 180);
    this.ctx.globalAlpha = layer.opacity;

    if (layer.isEmoji) {
      // Draw emoji as text
      const fontSize = Math.min(layer.width, layer.height) * 0.8;
      this.ctx.font = `${fontSize}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillText(layer.src, 0, 0);
    } else {
      // Draw image sticker
      const img = this.imageCache.get(layer.src);
      if (img) {
        this.ctx.drawImage(img, -layer.width / 2, -layer.height / 2, layer.width, layer.height);
      }
    }

    this.ctx.restore();
  }

  // Draw drawing layer
  private drawDrawing(layer: DrawingLayer): void {
    this.ctx.save();

    this.ctx.translate(layer.x, layer.y);
    this.ctx.globalAlpha = layer.opacity;

    layer.paths.forEach(path => {
      if (path.points.length < 2) return;

      this.ctx.beginPath();
      this.ctx.strokeStyle = path.color;
      this.ctx.lineWidth = path.width;
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
      this.ctx.globalAlpha = path.opacity * layer.opacity;

      this.ctx.moveTo(path.points[0].x, path.points[0].y);

      // Use quadratic curves for smooth lines
      for (let i = 1; i < path.points.length - 1; i++) {
        const xc = (path.points[i].x + path.points[i + 1].x) / 2;
        const yc = (path.points[i].y + path.points[i + 1].y) / 2;
        this.ctx.quadraticCurveTo(path.points[i].x, path.points[i].y, xc, yc);
      }

      // Last point
      const last = path.points[path.points.length - 1];
      this.ctx.lineTo(last.x, last.y);
      this.ctx.stroke();
    });

    this.ctx.restore();
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
        case 'background':
          this.drawBackground(layer);
          break;
        case 'media':
          this.drawMedia(layer);
          break;
        case 'text':
          this.drawText(layer);
          break;
        case 'sticker':
          this.drawSticker(layer);
          break;
        case 'drawing':
          this.drawDrawing(layer);
          break;
      }
    }
  }

  // Export to blob
  async toBlob(type: 'image/jpeg' | 'image/png' = 'image/jpeg', quality = 0.92): Promise<Blob> {
    await this.render();

    return new Promise((resolve, reject) => {
      this.canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Failed to create blob'));
        },
        type,
        quality
      );
    });
  }

  // Export to data URL
  async toDataURL(type: 'image/jpeg' | 'image/png' = 'image/jpeg', quality = 0.92): Promise<string> {
    await this.render();
    return this.canvas.toDataURL(type, quality);
  }

  // Hit test - find layer at point
  hitTest(x: number, y: number): Layer | null {
    // Check layers from top to bottom (reverse zIndex order)
    const sortedLayers = [...this.layers]
      .filter(l => l.visible && !l.locked && l.type !== 'background')
      .sort((a, b) => b.zIndex - a.zIndex);

    for (const layer of sortedLayers) {
      if (this.isPointInLayer(x, y, layer)) {
        return layer;
      }
    }

    return null;
  }

  // Check if point is inside layer (accounting for rotation)
  private isPointInLayer(px: number, py: number, layer: Layer): boolean {
    // Transform point to layer's local coordinate system
    const cx = layer.x + layer.width / 2;
    const cy = layer.y + layer.height / 2;

    // Translate point relative to layer center
    const dx = px - cx;
    const dy = py - cy;

    // Rotate point by negative layer rotation
    const angle = (-layer.rotation * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const localX = dx * cos - dy * sin;
    const localY = dx * sin + dy * cos;

    // Check if point is inside layer bounds
    return (
      localX >= -layer.width / 2 &&
      localX <= layer.width / 2 &&
      localY >= -layer.height / 2 &&
      localY <= layer.height / 2
    );
  }

  // Get bounding box corners for a layer (for resize handles)
  getLayerCorners(layer: Layer): { x: number; y: number }[] {
    const cx = layer.x + layer.width / 2;
    const cy = layer.y + layer.height / 2;
    const hw = layer.width / 2;
    const hh = layer.height / 2;
    const angle = (layer.rotation * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    const corners = [
      { x: -hw, y: -hh }, // top-left
      { x: hw, y: -hh },  // top-right
      { x: hw, y: hh },   // bottom-right
      { x: -hw, y: hh },  // bottom-left
    ];

    return corners.map(c => ({
      x: cx + c.x * cos - c.y * sin,
      y: cy + c.x * sin + c.y * cos,
    }));
  }

  // Create default text layer
  createTextLayer(content: string = 'テキスト'): TextLayer {
    return {
      id: generateLayerId(),
      type: 'text',
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
      fontWeight: 'bold',
      fontStyle: 'normal',
      color: '#ffffff',
      backgroundColor: 'rgba(0,0,0,0.5)',
      backgroundPadding: 16,
      backgroundRadius: 12,
      textAlign: 'center',
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
      type: 'media',
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
      type: 'sticker',
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
      type: 'drawing',
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
      console.error('Failed to deserialize canvas state:', e);
    }
  }
}

// Create and export singleton-like factory
export function createStoryCanvas(canvas?: HTMLCanvasElement): StoryCanvas {
  return new StoryCanvas(canvas);
}
