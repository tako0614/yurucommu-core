import { useEffect, type RefObject } from 'react';
import type { SnapGuide } from '../../../hooks/useCanvasInteraction';
import type { Layer, StoryCanvas } from '../../../lib/storyCanvas';
import { CANVAS_HEIGHT, CANVAS_WIDTH } from '../../../lib/storyCanvas';

interface StoryCanvasRendererOptions {
  storyCanvas: StoryCanvas | null;
  displayCanvasRef: RefObject<HTMLCanvasElement>;
  renderKey: number;
  snapGuides: SnapGuide[];
  getSelectedLayer: () => Layer | null;
}

const drawSelectionIndicator = (
  ctx: CanvasRenderingContext2D,
  storyCanvas: StoryCanvas,
  layer: Layer,
  scale: number
) => {
  const corners = storyCanvas.getLayerCorners(layer);
  if (!corners) return;

  const scaledCorners = corners.map((corner) => ({
    x: corner.x * scale,
    y: corner.y * scale,
  }));

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);

  ctx.beginPath();
  ctx.moveTo(scaledCorners[0].x, scaledCorners[0].y);
  scaledCorners.forEach((corner) => ctx.lineTo(corner.x, corner.y));
  ctx.closePath();
  ctx.stroke();

  ctx.setLineDash([]);
};

const drawSnapGuides = (
  ctx: CanvasRenderingContext2D,
  scale: number,
  displayWidth: number,
  displayHeight: number,
  snapGuides: SnapGuide[]
) => {
  if (snapGuides.length === 0) return;

  ctx.strokeStyle = '#FFD60A';
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 5]);

  for (const guide of snapGuides) {
    ctx.beginPath();
    if (guide.type === 'vertical') {
      const x = guide.position * scale;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, displayHeight);
    } else {
      const y = guide.position * scale;
      ctx.moveTo(0, y);
      ctx.lineTo(displayWidth, y);
    }
    ctx.stroke();
  }

  ctx.setLineDash([]);
};

export function useStoryCanvasRenderer({
  storyCanvas,
  displayCanvasRef,
  renderKey,
  snapGuides,
  getSelectedLayer,
}: StoryCanvasRendererOptions) {
  useEffect(() => {
    if (!storyCanvas) return;
    const displayCanvas = displayCanvasRef.current;
    if (!displayCanvas) return;

    const render = async () => {
      await storyCanvas.render();

      const displayCtx = displayCanvas.getContext('2d');
      if (!displayCtx) return;

      const displayWidth = displayCanvas.width;
      const displayHeight = displayCanvas.height;

      displayCtx.clearRect(0, 0, displayWidth, displayHeight);
      displayCtx.drawImage(
        storyCanvas.getCanvas(),
        0, 0, CANVAS_WIDTH, CANVAS_HEIGHT,
        0, 0, displayWidth, displayHeight
      );

      const scale = displayWidth / CANVAS_WIDTH;
      drawSnapGuides(displayCtx, scale, displayWidth, displayHeight, snapGuides);

      const selectedLayer = getSelectedLayer();
      if (selectedLayer && selectedLayer.type !== 'background') {
        drawSelectionIndicator(displayCtx, storyCanvas, selectedLayer, scale);
      }
    };

    render();
  }, [storyCanvas, displayCanvasRef, renderKey, snapGuides, getSelectedLayer]);
}
