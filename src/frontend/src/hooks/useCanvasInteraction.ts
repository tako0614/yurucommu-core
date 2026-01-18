/**
 * Canvas Interaction Hook - Instagram Style (Mobile + Desktop)
 *
 * Mobile:
 * - Single finger drag to move
 * - Pinch to resize
 * - Two finger rotation
 *
 * Desktop:
 * - Mouse drag to move
 * - Mouse wheel to resize
 * - Shift + wheel to rotate
 *
 * Both:
 * - Snap guides (center alignment)
 * - Drawing mode
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  StoryCanvas,
  Layer,
  DrawingLayer,
  DrawingPath,
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
} from '../lib/storyCanvas';

export type InteractionMode = 'select' | 'draw';

interface InteractionState {
  mode: InteractionMode;
  selectedLayerId: string | null;
  isDragging: boolean;
  isPinching: boolean;
  isDrawing: boolean;
}

// Snap guide types
export interface SnapGuide {
  type: 'vertical' | 'horizontal';
  position: number; // Canvas coordinate
}

interface DrawingSettings {
  color: string;
  width: number;
  opacity: number;
}

interface UseCanvasInteractionOptions {
  canvas: StoryCanvas | null;
  displayScale: number;
  onUpdate: () => void;
  onSnapGuidesChange?: (guides: SnapGuide[]) => void;
}

// Snap threshold in canvas coordinates
const SNAP_THRESHOLD = 20;

// Snap positions (relative to canvas)
const SNAP_POSITIONS = {
  centerX: CANVAS_WIDTH / 2,
  centerY: CANVAS_HEIGHT / 2,
  left: 60,
  right: CANVAS_WIDTH - 60,
  top: 100,
  bottom: CANVAS_HEIGHT - 100,
};

export function useCanvasInteraction({
  canvas,
  displayScale,
  onUpdate,
  onSnapGuidesChange,
}: UseCanvasInteractionOptions) {
  const [state, setState] = useState<InteractionState>({
    mode: 'select',
    selectedLayerId: null,
    isDragging: false,
    isPinching: false,
    isDrawing: false,
  });

  const [drawingSettings, setDrawingSettings] = useState<DrawingSettings>({
    color: '#ffffff',
    width: 8,
    opacity: 1,
  });

  // Refs for tracking interaction state
  const startPos = useRef({ x: 0, y: 0 });
  const startLayerState = useRef<Partial<Layer>>({});
  const currentDrawingPath = useRef<DrawingPath | null>(null);
  const drawingLayerId = useRef<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Pinch/rotation tracking
  const initialPinchDistance = useRef(0);
  const initialPinchAngle = useRef(0);
  const initialScale = useRef(1);
  const initialRotation = useRef(0);
  const lastTouchCount = useRef(0);

  // Convert display coordinates to canvas coordinates
  const displayToCanvas = useCallback((displayX: number, displayY: number) => {
    if (!containerRef.current) return { x: displayX, y: displayY };

    const rect = containerRef.current.getBoundingClientRect();
    const scaleX = CANVAS_WIDTH / rect.width;
    const scaleY = CANVAS_HEIGHT / rect.height;
    const x = (displayX - rect.left) * scaleX;
    const y = (displayY - rect.top) * scaleY;

    return { x, y };
  }, []);

  // Calculate snap guides for a layer
  const calculateSnapGuides = useCallback((layer: Layer): SnapGuide[] => {
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
  }, []);

  // Apply snap to position
  const applySnap = useCallback((x: number, y: number, width: number, height: number) => {
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
  }, []);

  // Refs for event handler access to avoid re-registering listeners
  const stateRef = useRef(state);
  const canvasRef = useRef(canvas);
  const displayToCanvasRef = useRef(displayToCanvas);
  const onUpdateRef = useRef(onUpdate);
  const applySnapRef = useRef(applySnap);
  const calculateSnapGuidesRef = useRef(calculateSnapGuides);
  const onSnapGuidesChangeRef = useRef(onSnapGuidesChange);
  const drawingSettingsRef = useRef(drawingSettings);

  // Keep refs updated for event handlers
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    canvasRef.current = canvas;
  }, [canvas]);

  useEffect(() => {
    displayToCanvasRef.current = displayToCanvas;
  }, [displayToCanvas]);

  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  useEffect(() => {
    applySnapRef.current = applySnap;
  }, [applySnap]);

  useEffect(() => {
    calculateSnapGuidesRef.current = calculateSnapGuides;
  }, [calculateSnapGuides]);

  useEffect(() => {
    onSnapGuidesChangeRef.current = onSnapGuidesChange;
  }, [onSnapGuidesChange]);

  useEffect(() => {
    drawingSettingsRef.current = drawingSettings;
  }, [drawingSettings]);

  // Get touch info (center point, distance, angle)
  const getTouchInfo = (touches: TouchList) => {
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
  };

  // Set the container ref
  const setContainerRef = useCallback((ref: HTMLDivElement | null) => {
    containerRef.current = ref;
  }, []);

  // Set interaction mode
  const setMode = useCallback((mode: InteractionMode) => {
    setState(prev => ({
      ...prev,
      mode,
      selectedLayerId: mode === 'draw' ? null : prev.selectedLayerId,
    }));
  }, []);

  // Select a layer
  const selectLayer = useCallback((layerId: string | null) => {
    setState(prev => ({ ...prev, selectedLayerId: layerId }));
  }, []);

  // Get selected layer
  const getSelectedLayer = useCallback((): Layer | null => {
    if (!canvas || !state.selectedLayerId) return null;
    return canvas.getLayer(state.selectedLayerId) || null;
  }, [canvas, state.selectedLayerId]);

  // Handle pointer/touch down
  const handlePointerDown = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!canvas) return;

    const isTouchEvent = 'touches' in e;
    const touchCount = isTouchEvent ? e.touches.length : 1;
    lastTouchCount.current = touchCount;

    if (state.mode === 'draw') {
      // Drawing mode - single touch only
      e.preventDefault();
      const clientX = isTouchEvent ? e.touches[0].clientX : e.clientX;
      const clientY = isTouchEvent ? e.touches[0].clientY : e.clientY;
      const canvasPos = displayToCanvas(clientX, clientY);

      // Find or create drawing layer
      let drawingLayer = canvas.getLayers().find(l => l.type === 'drawing') as DrawingLayer | undefined;
      if (!drawingLayer) {
        drawingLayer = canvas.createDrawingLayer();
        canvas.addLayer(drawingLayer);
        drawingLayerId.current = drawingLayer.id;
      } else {
        drawingLayerId.current = drawingLayer.id;
      }

      currentDrawingPath.current = {
        points: [{ x: canvasPos.x, y: canvasPos.y }],
        color: drawingSettings.color,
        width: drawingSettings.width,
        opacity: drawingSettings.opacity,
      };

      setState(prev => ({ ...prev, isDrawing: true }));
      return;
    }

    // Selection mode
    if (isTouchEvent && touchCount >= 2) {
      // Two finger gesture - pinch/rotate
      e.preventDefault();
      const touchInfo = getTouchInfo(e.touches as unknown as TouchList);
      initialPinchDistance.current = touchInfo.distance;
      initialPinchAngle.current = touchInfo.angle;

      if (state.selectedLayerId) {
        const layer = canvas.getLayer(state.selectedLayerId);
        if (layer) {
          initialScale.current = layer.width / (startLayerState.current.width || layer.width);
          initialRotation.current = layer.rotation;
          startLayerState.current = {
            x: layer.x,
            y: layer.y,
            width: layer.width,
            height: layer.height,
            rotation: layer.rotation,
          };
        }
      }

      setState(prev => ({ ...prev, isPinching: true }));
    } else {
      // Single finger - hit test and drag
      const clientX = isTouchEvent ? e.touches[0].clientX : e.clientX;
      const clientY = isTouchEvent ? e.touches[0].clientY : e.clientY;
      const canvasPos = displayToCanvas(clientX, clientY);

      startPos.current = canvasPos;

      const hitLayer = canvas.hitTest(canvasPos.x, canvasPos.y);

      if (hitLayer && hitLayer.type !== 'background') {
        startLayerState.current = {
          x: hitLayer.x,
          y: hitLayer.y,
          width: hitLayer.width,
          height: hitLayer.height,
          rotation: hitLayer.rotation,
        };

        setState(prev => ({
          ...prev,
          selectedLayerId: hitLayer.id,
          isDragging: true,
        }));
      } else {
        setState(prev => ({
          ...prev,
          selectedLayerId: null,
          isDragging: false,
        }));
        onSnapGuidesChange?.([]);
      }
    }
  }, [canvas, state.mode, state.selectedLayerId, displayToCanvas, drawingSettings, onSnapGuidesChange]);

  // Handle pointer/touch move - uses refs to avoid recreating handler
  const handlePointerMove = useCallback((e: MouseEvent | TouchEvent) => {
    const currentCanvas = canvasRef.current;
    const currentState = stateRef.current;
    const currentDisplayToCanvas = displayToCanvasRef.current;
    const currentOnUpdate = onUpdateRef.current;
    const currentApplySnap = applySnapRef.current;
    const currentCalculateSnapGuides = calculateSnapGuidesRef.current;
    const currentOnSnapGuidesChange = onSnapGuidesChangeRef.current;

    if (!currentCanvas) return;

    const isTouchEvent = 'touches' in e;
    const touchCount = isTouchEvent ? e.touches.length : 1;

    if (currentState.isDrawing && currentDrawingPath.current && drawingLayerId.current) {
      // Drawing
      const clientX = isTouchEvent ? e.touches[0].clientX : e.clientX;
      const clientY = isTouchEvent ? e.touches[0].clientY : e.clientY;
      const canvasPos = currentDisplayToCanvas(clientX, clientY);

      currentDrawingPath.current.points.push({
        x: canvasPos.x,
        y: canvasPos.y,
      });

      const drawingLayer = currentCanvas.getLayer(drawingLayerId.current) as DrawingLayer;
      if (drawingLayer) {
        const paths = [...drawingLayer.paths];
        const pathIndex = paths.findIndex(p => p === currentDrawingPath.current);
        if (pathIndex === -1) {
          paths.push(currentDrawingPath.current);
        } else {
          paths[pathIndex] = currentDrawingPath.current;
        }
        currentCanvas.updateLayer(drawingLayerId.current, { paths });
        currentOnUpdate();
      }
    } else if (currentState.isPinching && currentState.selectedLayerId && isTouchEvent && touchCount >= 2) {
      // Pinch to resize and rotate
      const touchInfo = getTouchInfo(e.touches);
      const layer = currentCanvas.getLayer(currentState.selectedLayerId);
      if (!layer) return;

      // Calculate scale change
      const scaleChange = touchInfo.distance / initialPinchDistance.current;
      const newWidth = (startLayerState.current.width || 100) * scaleChange;
      const newHeight = (startLayerState.current.height || 100) * scaleChange;

      // Calculate rotation change
      const angleChange = touchInfo.angle - initialPinchAngle.current;
      const newRotation = (startLayerState.current.rotation || 0) + angleChange;

      // Keep center position
      const centerX = (startLayerState.current.x || 0) + (startLayerState.current.width || 0) / 2;
      const centerY = (startLayerState.current.y || 0) + (startLayerState.current.height || 0) / 2;
      const newX = centerX - newWidth / 2;
      const newY = centerY - newHeight / 2;

      // Apply minimum size
      const minSize = 50;
      if (newWidth >= minSize && newHeight >= minSize) {
        currentCanvas.updateLayer(currentState.selectedLayerId, {
          x: newX,
          y: newY,
          width: newWidth,
          height: newHeight,
          rotation: newRotation,
        });
        currentOnUpdate();
      }
    } else if (currentState.isDragging && currentState.selectedLayerId) {
      // Drag to move
      const clientX = isTouchEvent ? e.touches[0].clientX : e.clientX;
      const clientY = isTouchEvent ? e.touches[0].clientY : e.clientY;
      const canvasPos = currentDisplayToCanvas(clientX, clientY);

      const dx = canvasPos.x - startPos.current.x;
      const dy = canvasPos.y - startPos.current.y;

      let newX = (startLayerState.current.x || 0) + dx;
      let newY = (startLayerState.current.y || 0) + dy;

      const layer = currentCanvas.getLayer(currentState.selectedLayerId);
      if (layer) {
        // Apply snap
        const snapped = currentApplySnap(newX, newY, layer.width, layer.height);
        newX = snapped.x;
        newY = snapped.y;

        // Calculate and emit snap guides
        const tempLayer = { ...layer, x: newX, y: newY };
        const guides = currentCalculateSnapGuides(tempLayer);
        currentOnSnapGuidesChange?.(guides);
      }

      currentCanvas.updateLayer(currentState.selectedLayerId, {
        x: newX,
        y: newY,
      });
      currentOnUpdate();
    }

    // Check if touch count changed (e.g., added second finger)
    if (isTouchEvent && touchCount !== lastTouchCount.current) {
      if (touchCount >= 2 && currentState.isDragging && currentState.selectedLayerId) {
        // Transition from drag to pinch
        const touchInfo = getTouchInfo(e.touches);
        initialPinchDistance.current = touchInfo.distance;
        initialPinchAngle.current = touchInfo.angle;

        const layer = currentCanvas.getLayer(currentState.selectedLayerId);
        if (layer) {
          startLayerState.current = {
            x: layer.x,
            y: layer.y,
            width: layer.width,
            height: layer.height,
            rotation: layer.rotation,
          };
        }

        setState(prev => ({ ...prev, isDragging: false, isPinching: true }));
      } else if (touchCount === 1 && currentState.isPinching && currentState.selectedLayerId) {
        // Transition from pinch to drag
        const canvasPos = currentDisplayToCanvas(e.touches[0].clientX, e.touches[0].clientY);
        startPos.current = canvasPos;

        const layer = currentCanvas.getLayer(currentState.selectedLayerId);
        if (layer) {
          startLayerState.current = {
            x: layer.x,
            y: layer.y,
            width: layer.width,
            height: layer.height,
            rotation: layer.rotation,
          };
        }

        setState(prev => ({ ...prev, isPinching: false, isDragging: true }));
      }
      lastTouchCount.current = touchCount;
    }
  }, []); // Empty deps - uses refs for current values

  // Handle pointer/touch up - uses refs to avoid recreating handler
  const handlePointerUp = useCallback(() => {
    const currentCanvas = canvasRef.current;
    const currentState = stateRef.current;
    const currentOnUpdate = onUpdateRef.current;
    const currentOnSnapGuidesChange = onSnapGuidesChangeRef.current;

    if (currentState.isDrawing && currentDrawingPath.current && drawingLayerId.current && currentCanvas) {
      const drawingLayer = currentCanvas.getLayer(drawingLayerId.current) as DrawingLayer;
      if (drawingLayer) {
        const paths = [...drawingLayer.paths];
        if (!paths.includes(currentDrawingPath.current)) {
          paths.push(currentDrawingPath.current);
          currentCanvas.updateLayer(drawingLayerId.current, { paths });
        }
        currentOnUpdate();
      }
      currentDrawingPath.current = null;
    }

    // Clear snap guides
    currentOnSnapGuidesChange?.([]);

    setState(prev => ({
      ...prev,
      isDragging: false,
      isPinching: false,
      isDrawing: false,
    }));

    lastTouchCount.current = 0;
  }, []); // Empty deps - uses refs for current values

  // Clear drawing
  const clearDrawing = useCallback(() => {
    if (!canvas) return;

    const drawingLayer = canvas.getLayers().find(l => l.type === 'drawing');
    if (drawingLayer) {
      canvas.removeLayer(drawingLayer.id);
      drawingLayerId.current = null;
      onUpdate();
    }
  }, [canvas, onUpdate]);

  // Undo last drawing stroke
  const undoDrawing = useCallback(() => {
    if (!canvas || !drawingLayerId.current) return;

    const drawingLayer = canvas.getLayer(drawingLayerId.current) as DrawingLayer;
    if (drawingLayer && drawingLayer.paths.length > 0) {
      const paths = drawingLayer.paths.slice(0, -1);
      canvas.updateLayer(drawingLayerId.current, { paths });
      onUpdate();
    }
  }, [canvas, onUpdate]);

  // Handle mouse wheel for resize (PC) or rotate (Shift + wheel)
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!canvas || !state.selectedLayerId || state.mode === 'draw') return;

    const layer = canvas.getLayer(state.selectedLayerId);
    if (!layer || layer.type === 'background') return;

    e.preventDefault();

    const delta = e.deltaY > 0 ? -1 : 1;

    if (e.shiftKey) {
      // Shift + wheel = rotate
      const rotationStep = 5; // degrees per scroll
      const newRotation = (layer.rotation + delta * rotationStep) % 360;
      canvas.updateLayer(state.selectedLayerId, { rotation: newRotation });
    } else {
      // Wheel = resize (maintain aspect ratio)
      const scaleFactor = 1 + delta * 0.05; // 5% per scroll
      const newWidth = Math.max(50, layer.width * scaleFactor);
      const newHeight = Math.max(50, layer.height * scaleFactor);

      // Keep center position
      const centerX = layer.x + layer.width / 2;
      const centerY = layer.y + layer.height / 2;
      const newX = centerX - newWidth / 2;
      const newY = centerY - newHeight / 2;

      canvas.updateLayer(state.selectedLayerId, {
        x: newX,
        y: newY,
        width: newWidth,
        height: newHeight,
      });
    }

    onUpdate();
  }, [canvas, state.selectedLayerId, state.mode, onUpdate]);

  // Add event listeners - attach once and use refs to check state
  useEffect(() => {
    const onMove = (e: MouseEvent | TouchEvent) => {
      const currentState = stateRef.current;
      if (currentState.isDragging || currentState.isPinching || currentState.isDrawing) {
        e.preventDefault();
        handlePointerMove(e);
      }
    };

    const onUp = () => {
      const currentState = stateRef.current;
      if (currentState.isDragging || currentState.isPinching || currentState.isDrawing) {
        handlePointerUp();
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);

    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };
  }, [handlePointerMove, handlePointerUp]); // These handlers now have empty deps, so this effect runs once

  return {
    state,
    setMode,
    setContainerRef,
    selectLayer,
    getSelectedLayer,
    handlePointerDown,
    handleWheel,
    drawingSettings,
    setDrawingSettings,
    clearDrawing,
    undoDrawing,
  };
}
