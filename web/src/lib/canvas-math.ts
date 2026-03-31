/**
 * Canvas Math/Geometry Utilities
 *
 * Pure math functions for canvas coordinate conversion,
 * snap guide calculation, and touch gesture info extraction.
 * No React dependencies.
 */

import { CANVAS_WIDTH, CANVAS_HEIGHT, type Layer } from './story-canvas.ts';

// Snap guide types
export interface SnapGuide {
  type: 'vertical' | 'horizontal';
  position: number; // Canvas coordinate
}

// Snap threshold in canvas coordinates
export const SNAP_THRESHOLD = 20;

// Snap positions (relative to canvas)
export const SNAP_POSITIONS = {
  centerX: CANVAS_WIDTH / 2,
  centerY: CANVAS_HEIGHT / 2,
  left: 60,
  right: CANVAS_WIDTH - 60,
  top: 100,
  bottom: CANVAS_HEIGHT - 100,
};

/** Touch info result */
export interface TouchInfo {
  center: { x: number; y: number };
  distance: number;
  angle: number;
}

/**
 * Convert display (screen) coordinates to canvas coordinates.
 *
 * @param displayX - Screen X coordinate (e.g. clientX)
 * @param displayY - Screen Y coordinate (e.g. clientY)
 * @param containerRect - Bounding rect of the canvas container element
 * @returns Canvas coordinates
 */
export function displayToCanvas(
  displayX: number,
  displayY: number,
  containerRect: DOMRect | null,
): { x: number; y: number } {
  if (!containerRect) return { x: displayX, y: displayY };

  const scaleX = CANVAS_WIDTH / containerRect.width;
  const scaleY = CANVAS_HEIGHT / containerRect.height;
  const x = (displayX - containerRect.left) * scaleX;
  const y = (displayY - containerRect.top) * scaleY;

  return { x, y };
}

/**
 * Calculate snap guides for a layer based on its center position
 * relative to canvas snap positions.
 */
export function calculateSnapGuides(layer: Layer): SnapGuide[] {
  const guides: SnapGuide[] = [];
  const centerX = layer.x + layer.width / 2;
  const centerY = layer.y + layer.height / 2;

  // Center X snap
  if (Math.abs(centerX - SNAP_POSITIONS.centerX) < SNAP_THRESHOLD) {
    guides.push({ type: 'vertical', position: SNAP_POSITIONS.centerX });
  }

  // Center Y snap
  if (Math.abs(centerY - SNAP_POSITIONS.centerY) < SNAP_THRESHOLD) {
    guides.push({ type: 'horizontal', position: SNAP_POSITIONS.centerY });
  }

  return guides;
}

/**
 * Apply snap to a position. If the layer center is close enough
 * to a snap position, adjust its coordinates to align.
 */
export function applySnap(
  x: number,
  y: number,
  width: number,
  height: number,
): { x: number; y: number } {
  let snappedX = x;
  let snappedY = y;
  const centerX = x + width / 2;
  const centerY = y + height / 2;

  // Snap to center X
  if (Math.abs(centerX - SNAP_POSITIONS.centerX) < SNAP_THRESHOLD) {
    snappedX = SNAP_POSITIONS.centerX - width / 2;
  }

  // Snap to center Y
  if (Math.abs(centerY - SNAP_POSITIONS.centerY) < SNAP_THRESHOLD) {
    snappedY = SNAP_POSITIONS.centerY - height / 2;
  }

  return { x: snappedX, y: snappedY };
}

/**
 * Extract touch gesture info: center point, distance between fingers,
 * and angle of the line connecting two touches.
 */
export function getTouchInfo(touches: TouchList): TouchInfo {
  if (touches.length === 1) {
    return {
      center: { x: touches[0].clientX, y: touches[0].clientY },
      distance: 0,
      angle: 0,
    };
  }

  const t1 = touches[0];
  const t2 = touches[1];
  const centerX = (t1.clientX + t2.clientX) / 2;
  const centerY = (t1.clientY + t2.clientY) / 2;
  const dx = t2.clientX - t1.clientX;
  const dy = t2.clientY - t1.clientY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);

  return {
    center: { x: centerX, y: centerY },
    distance,
    angle,
  };
}
