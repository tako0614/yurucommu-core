/**
 * Story Canvas Drawing Functions
 *
 * Drawing/rendering functions for each layer type.
 * These are called by the main StoryCanvas class.
 */

import type {
  BackgroundLayer,
  DrawingLayer,
  ImageFilter,
  MediaLayer,
  StickerLayer,
  TextLayer,
} from "./story-canvas.ts";
import { CANVAS_HEIGHT, CANVAS_WIDTH } from "./story-canvas.ts";

// ---------------------------------------------------------------------------
// Filter string builder
// ---------------------------------------------------------------------------

export function getFilterString(filter: ImageFilter): string {
  const parts: string[] = [];
  if (filter.brightness !== 100) {
    parts.push(`brightness(${filter.brightness}%)`);
  }
  if (filter.contrast !== 100) parts.push(`contrast(${filter.contrast}%)`);
  if (filter.saturation !== 100) parts.push(`saturate(${filter.saturation}%)`);
  if (filter.blur > 0) parts.push(`blur(${filter.blur}px)`);
  if (filter.sepia > 0) parts.push(`sepia(${filter.sepia}%)`);
  if (filter.grayscale > 0) parts.push(`grayscale(${filter.grayscale}%)`);
  if (filter.hueRotate !== 0) parts.push(`hue-rotate(${filter.hueRotate}deg)`);
  return parts.join(" ") || "none";
}

// ---------------------------------------------------------------------------
// Background drawing
// ---------------------------------------------------------------------------

export function drawBackground(
  ctx: CanvasRenderingContext2D,
  layer: BackgroundLayer,
  imageCache: Map<string, HTMLImageElement>,
): void {
  const { fill } = layer;

  if (fill.type === "solid") {
    ctx.fillStyle = fill.color;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  } else if (fill.type === "gradient") {
    const radians = (fill.angle * Math.PI) / 180;
    const x1 = CANVAS_WIDTH / 2 - Math.cos(radians) * CANVAS_WIDTH;
    const y1 = CANVAS_HEIGHT / 2 - Math.sin(radians) * CANVAS_HEIGHT;
    const x2 = CANVAS_WIDTH / 2 + Math.cos(radians) * CANVAS_WIDTH;
    const y2 = CANVAS_HEIGHT / 2 + Math.sin(radians) * CANVAS_HEIGHT;

    const gradient = ctx.createLinearGradient(x1, y1, x2, y2);
    fill.colors.forEach((color, i) => {
      gradient.addColorStop(i / (fill.colors.length - 1), color);
    });

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  } else if (fill.type === "image") {
    const img = imageCache.get(fill.src);
    if (img) {
      // Cover the canvas
      const scale = Math.max(
        CANVAS_WIDTH / img.width,
        CANVAS_HEIGHT / img.height,
      );
      const w = img.width * scale;
      const h = img.height * scale;
      const x = (CANVAS_WIDTH - w) / 2;
      const y = (CANVAS_HEIGHT - h) / 2;
      ctx.drawImage(img, x, y, w, h);
    }
  }
  // 'transparent' type: do nothing, canvas is already cleared
}

// ---------------------------------------------------------------------------
// Media drawing
// ---------------------------------------------------------------------------

export function drawMedia(
  ctx: CanvasRenderingContext2D,
  layer: MediaLayer,
  imageCache: Map<string, HTMLImageElement>,
): void {
  const img = imageCache.get(layer.src);
  if (!img) return;

  ctx.save();

  // Apply transform
  ctx.translate(layer.x + layer.width / 2, layer.y + layer.height / 2);
  ctx.rotate((layer.rotation * Math.PI) / 180);
  ctx.globalAlpha = layer.opacity;

  // Apply filter
  if (layer.filter) {
    ctx.filter = getFilterString(layer.filter);
  }

  // Draw image
  ctx.drawImage(
    img,
    -layer.width / 2,
    -layer.height / 2,
    layer.width,
    layer.height,
  );

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Text drawing helpers
// ---------------------------------------------------------------------------

function measureTextWithSpacing(
  ctx: CanvasRenderingContext2D,
  text: string,
  letterSpacing: number,
): number {
  const chars = [...text];
  let width = 0;
  chars.forEach((char, i) => {
    width += ctx.measureText(char).width;
    if (i < chars.length - 1) width += letterSpacing;
  });
  return width;
}

function drawTextLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  letterSpacing: number,
): void {
  if (letterSpacing === 0) {
    ctx.fillText(text, x, y);
  } else {
    const chars = [...text];
    let currentX = x;

    // Adjust starting position for center/right alignment
    if (ctx.textAlign === "center") {
      const totalWidth = measureTextWithSpacing(ctx, text, letterSpacing);
      currentX = x - totalWidth / 2;
      ctx.textAlign = "left";
    } else if (ctx.textAlign === "right") {
      const totalWidth = measureTextWithSpacing(ctx, text, letterSpacing);
      currentX = x - totalWidth;
      ctx.textAlign = "left";
    }

    chars.forEach((char) => {
      ctx.fillText(char, currentX, y);
      currentX += ctx.measureText(char).width + letterSpacing;
    });
  }
}

function strokeTextLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  letterSpacing: number,
): void {
  if (letterSpacing === 0) {
    ctx.strokeText(text, x, y);
  } else {
    const chars = [...text];
    let currentX = x;

    if (ctx.textAlign === "center") {
      const totalWidth = measureTextWithSpacing(ctx, text, letterSpacing);
      currentX = x - totalWidth / 2;
    } else if (ctx.textAlign === "right") {
      const totalWidth = measureTextWithSpacing(ctx, text, letterSpacing);
      currentX = x - totalWidth;
    }

    const savedAlign = ctx.textAlign;
    ctx.textAlign = "left";

    chars.forEach((char) => {
      ctx.strokeText(char, currentX, y);
      currentX += ctx.measureText(char).width + letterSpacing;
    });

    ctx.textAlign = savedAlign;
  }
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  letterSpacing: number,
): string[] {
  const lines: string[] = [];
  const paragraphs = text.split("\n");

  paragraphs.forEach((paragraph) => {
    if (paragraph === "") {
      lines.push("");
      return;
    }

    const chars = [...paragraph];
    let currentLine = "";

    chars.forEach((char) => {
      const testLine = currentLine + char;
      const testWidth = letterSpacing === 0
        ? ctx.measureText(testLine).width
        : measureTextWithSpacing(ctx, testLine, letterSpacing);

      if (testWidth > maxWidth && currentLine !== "") {
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

  return lines.length > 0 ? lines : [""];
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  if (r === 0) {
    ctx.rect(x, y, w, h);
    return;
  }

  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ---------------------------------------------------------------------------
// Text drawing
// ---------------------------------------------------------------------------

export function drawText(
  ctx: CanvasRenderingContext2D,
  layer: TextLayer,
): void {
  ctx.save();

  // Apply transform
  ctx.translate(layer.x + layer.width / 2, layer.y + layer.height / 2);
  ctx.rotate((layer.rotation * Math.PI) / 180);
  ctx.globalAlpha = layer.opacity;

  // Draw background if set
  if (layer.backgroundColor) {
    ctx.fillStyle = layer.backgroundColor;
    const padding = layer.backgroundPadding;
    const radius = layer.backgroundRadius;

    roundRect(
      ctx,
      -layer.width / 2 - padding,
      -layer.height / 2 - padding,
      layer.width + padding * 2,
      layer.height + padding * 2,
      radius,
    );
    ctx.fill();
  }

  // Set text style
  const fontStyle = layer.fontStyle === "italic" ? "italic " : "";
  const fontWeight = layer.fontWeight === "bold" ? "bold " : "";
  ctx.font = `${fontStyle}${fontWeight}${layer.fontSize}px ${layer.fontFamily}`;
  ctx.textAlign = layer.textAlign;
  ctx.textBaseline = "top";

  // Calculate text metrics and wrap
  const lines = wrapText(ctx, layer.content, layer.width, layer.letterSpacing);
  const lineHeight = layer.fontSize * layer.lineHeight;
  const totalHeight = lines.length * lineHeight;
  const startY = -totalHeight / 2;

  // Calculate X based on alignment
  let textX = 0;
  if (layer.textAlign === "left") textX = -layer.width / 2;
  else if (layer.textAlign === "right") textX = layer.width / 2;

  // Draw each line
  lines.forEach((line, i) => {
    const y = startY + i * lineHeight;

    // Draw shadow if set
    if (layer.shadow) {
      ctx.save();
      ctx.shadowColor = layer.shadow.color;
      ctx.shadowBlur = layer.shadow.blur;
      ctx.shadowOffsetX = layer.shadow.offsetX;
      ctx.shadowOffsetY = layer.shadow.offsetY;
      ctx.fillStyle = layer.color;
      drawTextLine(ctx, line, textX, y, layer.letterSpacing);
      ctx.restore();
    }

    // Draw stroke if set
    if (layer.stroke) {
      ctx.strokeStyle = layer.stroke.color;
      ctx.lineWidth = layer.stroke.width;
      ctx.lineJoin = "round";
      strokeTextLine(ctx, line, textX, y, layer.letterSpacing);
    }

    // Draw text
    ctx.fillStyle = layer.color;
    drawTextLine(ctx, line, textX, y, layer.letterSpacing);
  });

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Sticker drawing
// ---------------------------------------------------------------------------

export function drawSticker(
  ctx: CanvasRenderingContext2D,
  layer: StickerLayer,
  imageCache: Map<string, HTMLImageElement>,
): void {
  ctx.save();

  ctx.translate(layer.x + layer.width / 2, layer.y + layer.height / 2);
  ctx.rotate((layer.rotation * Math.PI) / 180);
  ctx.globalAlpha = layer.opacity;

  if (layer.isEmoji) {
    // Draw emoji as text
    const fontSize = Math.min(layer.width, layer.height) * 0.8;
    ctx.font =
      `${fontSize}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(layer.src, 0, 0);
  } else {
    // Draw image sticker
    const img = imageCache.get(layer.src);
    if (img) {
      ctx.drawImage(
        img,
        -layer.width / 2,
        -layer.height / 2,
        layer.width,
        layer.height,
      );
    }
  }

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Drawing layer (freehand paths)
// ---------------------------------------------------------------------------

export function drawDrawing(
  ctx: CanvasRenderingContext2D,
  layer: DrawingLayer,
): void {
  ctx.save();

  ctx.translate(layer.x, layer.y);
  ctx.globalAlpha = layer.opacity;

  layer.paths.forEach((path) => {
    if (path.points.length < 2) return;

    ctx.beginPath();
    ctx.strokeStyle = path.color;
    ctx.lineWidth = path.width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalAlpha = path.opacity * layer.opacity;

    ctx.moveTo(path.points[0].x, path.points[0].y);

    // Use quadratic curves for smooth lines
    for (let i = 1; i < path.points.length - 1; i++) {
      const xc = (path.points[i].x + path.points[i + 1].x) / 2;
      const yc = (path.points[i].y + path.points[i + 1].y) / 2;
      ctx.quadraticCurveTo(path.points[i].x, path.points[i].y, xc, yc);
    }

    // Last point
    const last = path.points[path.points.length - 1];
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
  });

  ctx.restore();
}
