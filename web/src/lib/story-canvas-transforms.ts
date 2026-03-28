/**
 * Story Canvas Transform Utilities
 *
 * Hit testing, coordinate transformation, and bounding box calculations.
 */

import type { Layer } from './story-canvas';

// ---------------------------------------------------------------------------
// Hit testing
// ---------------------------------------------------------------------------

/**
 * Check if a point (px, py) is inside a layer, accounting for rotation.
 */
export function isPointInLayer(px: number, py: number, layer: Layer): boolean {
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

/**
 * Find the topmost visible, unlocked, non-background layer at a given point.
 */
export function hitTest(layers: Layer[], x: number, y: number): Layer | null {
  // Check layers from top to bottom (reverse zIndex order)
  const sortedLayers = [...layers]
    .filter(l => l.visible && !l.locked && l.type !== 'background')
    .sort((a, b) => b.zIndex - a.zIndex);

  for (const layer of sortedLayers) {
    if (isPointInLayer(x, y, layer)) {
      return layer;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Bounding box
// ---------------------------------------------------------------------------

/**
 * Get the four corner positions of a layer in canvas space,
 * accounting for rotation. Useful for rendering resize handles.
 */
export function getLayerCorners(layer: Layer): { x: number; y: number }[] {
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
