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

import { createEffect, createSignal, onCleanup } from "solid-js";
import type { JSX } from "solid-js/jsx-runtime";
import {
  DrawingLayer,
  DrawingPath,
  Layer,
  StoryCanvas,
} from "../lib/story-canvas.ts";
import {
  applySnap as applySnapImpl,
  calculateSnapGuides as calculateSnapGuidesImpl,
  displayToCanvas as displayToCanvasImpl,
  getTouchInfo,
  type SnapGuide,
} from "../lib/canvas-math.ts";

export type { SnapGuide };
export type InteractionMode = "select" | "draw";

interface InteractionState {
  mode: InteractionMode;
  selectedLayerId: string | null;
  isDragging: boolean;
  isPinching: boolean;
  isDrawing: boolean;
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

export function useCanvasInteraction({
  canvas,
  displayScale,
  onUpdate,
  onSnapGuidesChange,
}: UseCanvasInteractionOptions) {
  const [state, setState] = createSignal<InteractionState>({
    mode: "select",
    selectedLayerId: null,
    isDragging: false,
    isPinching: false,
    isDrawing: false,
  });

  const [drawingSettings, setDrawingSettings] = createSignal<DrawingSettings>({
    color: "#ffffff",
    width: 8,
    opacity: 1,
  });

  // Refs for tracking interaction state
  let startPos = { x: 0, y: 0 };
  let startLayerStateRef: Partial<Layer> = {};
  let currentDrawingPath: DrawingPath | null = null;
  let drawingLayerIdRef: string | null = null;
  let containerRefEl: HTMLDivElement | null = null;

  // Pinch/rotation tracking
  let initialPinchDistance = 0;
  let initialPinchAngle = 0;
  let initialScaleRef = 1;
  let initialRotationRef = 0;
  let lastTouchCount = 0;

  // Convert display coordinates to canvas coordinates
  const displayToCanvas = (displayX: number, displayY: number) => {
    const rect = containerRefEl?.getBoundingClientRect() ?? null;
    return displayToCanvasImpl(displayX, displayY, rect);
  };

  // Calculate snap guides for a layer
  const calculateSnapGuides = (layer: Layer): SnapGuide[] => {
    return calculateSnapGuidesImpl(layer);
  };

  // Apply snap to position
  const applySnap = (x: number, y: number, width: number, height: number) => {
    return applySnapImpl(x, y, width, height);
  };

  // Set the container ref
  const setContainerRef = (ref: HTMLDivElement | null) => {
    containerRefEl = ref;
  };

  // Set interaction mode
  const setMode = (mode: InteractionMode) => {
    setState((prev) => ({
      ...prev,
      mode,
      selectedLayerId: mode === "draw" ? null : prev.selectedLayerId,
    }));
  };

  // Select a layer
  const selectLayer = (layerId: string | null) => {
    setState((prev) => ({ ...prev, selectedLayerId: layerId }));
  };

  // Get selected layer
  const getSelectedLayer = (): Layer | null => {
    const s = state();
    if (!canvas || !s.selectedLayerId) return null;
    return canvas.getLayer(s.selectedLayerId) || null;
  };

  // Handle pointer/touch down
  const handlePointerDown = (e: MouseEvent | TouchEvent) => {
    if (!canvas) return;

    const isTouchEvent = "touches" in e;
    const touchCount = isTouchEvent ? e.touches.length : 1;
    lastTouchCount = touchCount;

    const currentState = state();
    const currentDrawingSettings = drawingSettings();

    if (currentState.mode === "draw") {
      // Drawing mode - single touch only
      e.preventDefault();
      const clientX = isTouchEvent
        ? e.touches[0].clientX
        : (e as MouseEvent).clientX;
      const clientY = isTouchEvent
        ? e.touches[0].clientY
        : (e as MouseEvent).clientY;
      const canvasPos = displayToCanvas(clientX, clientY);

      // Find or create drawing layer
      let drawingLayer = canvas.getLayers().find((l) => l.type === "drawing") as
        | DrawingLayer
        | undefined;
      if (!drawingLayer) {
        drawingLayer = canvas.createDrawingLayer();
        canvas.addLayer(drawingLayer);
        drawingLayerIdRef = drawingLayer.id;
      } else {
        drawingLayerIdRef = drawingLayer.id;
      }

      currentDrawingPath = {
        points: [{ x: canvasPos.x, y: canvasPos.y }],
        color: currentDrawingSettings.color,
        width: currentDrawingSettings.width,
        opacity: currentDrawingSettings.opacity,
      };

      setState((prev) => ({ ...prev, isDrawing: true }));
      return;
    }

    // Selection mode
    if (isTouchEvent && touchCount >= 2) {
      // Two finger gesture - pinch/rotate
      e.preventDefault();
      const touchInfo = getTouchInfo(e.touches);
      initialPinchDistance = touchInfo.distance;
      initialPinchAngle = touchInfo.angle;

      if (currentState.selectedLayerId) {
        const layer = canvas.getLayer(currentState.selectedLayerId);
        if (layer) {
          initialScaleRef = layer.width /
            (startLayerStateRef.width || layer.width);
          initialRotationRef = layer.rotation;
          startLayerStateRef = {
            x: layer.x,
            y: layer.y,
            width: layer.width,
            height: layer.height,
            rotation: layer.rotation,
          };
        }
      }

      setState((prev) => ({ ...prev, isPinching: true }));
    } else {
      // Single finger - hit test and drag
      const clientX = isTouchEvent
        ? e.touches[0].clientX
        : (e as MouseEvent).clientX;
      const clientY = isTouchEvent
        ? e.touches[0].clientY
        : (e as MouseEvent).clientY;
      const canvasPos = displayToCanvas(clientX, clientY);

      startPos = canvasPos;

      const hitLayer = canvas.hitTest(canvasPos.x, canvasPos.y);

      if (hitLayer && hitLayer.type !== "background") {
        startLayerStateRef = {
          x: hitLayer.x,
          y: hitLayer.y,
          width: hitLayer.width,
          height: hitLayer.height,
          rotation: hitLayer.rotation,
        };

        setState((prev) => ({
          ...prev,
          selectedLayerId: hitLayer.id,
          isDragging: true,
        }));
      } else {
        setState((prev) => ({
          ...prev,
          selectedLayerId: null,
          isDragging: false,
        }));
        onSnapGuidesChange?.([]);
      }
    }
  };

  // Handle pointer/touch move
  const handlePointerMove = (e: MouseEvent | TouchEvent) => {
    if (!canvas) return;

    const currentState = state();
    const isTouchEvent = "touches" in e;
    const touchCount = isTouchEvent ? e.touches.length : 1;

    if (currentState.isDrawing && currentDrawingPath && drawingLayerIdRef) {
      // Drawing
      const clientX = isTouchEvent
        ? e.touches[0].clientX
        : (e as MouseEvent).clientX;
      const clientY = isTouchEvent
        ? e.touches[0].clientY
        : (e as MouseEvent).clientY;
      const canvasPos = displayToCanvas(clientX, clientY);

      currentDrawingPath.points.push({
        x: canvasPos.x,
        y: canvasPos.y,
      });

      const drawingLayer = canvas.getLayer(drawingLayerIdRef) as DrawingLayer;
      if (drawingLayer) {
        const paths = [...drawingLayer.paths];
        const pathIndex = paths.findIndex((p) => p === currentDrawingPath);
        if (pathIndex === -1) {
          paths.push(currentDrawingPath);
        } else {
          paths[pathIndex] = currentDrawingPath;
        }
        canvas.updateLayer(drawingLayerIdRef, { paths });
        onUpdate();
      }
    } else if (
      currentState.isPinching && currentState.selectedLayerId && isTouchEvent &&
      touchCount >= 2
    ) {
      // Pinch to resize and rotate
      const touchInfo = getTouchInfo(e.touches);
      const layer = canvas.getLayer(currentState.selectedLayerId);
      if (!layer) return;

      // Calculate scale change
      const scaleChange = touchInfo.distance / initialPinchDistance;
      const newWidth = (startLayerStateRef.width || 100) * scaleChange;
      const newHeight = (startLayerStateRef.height || 100) * scaleChange;

      // Calculate rotation change
      const angleChange = touchInfo.angle - initialPinchAngle;
      const newRotation = (startLayerStateRef.rotation || 0) + angleChange;

      // Keep center position
      const centerX = (startLayerStateRef.x || 0) +
        (startLayerStateRef.width || 0) / 2;
      const centerY = (startLayerStateRef.y || 0) +
        (startLayerStateRef.height || 0) / 2;
      const newX = centerX - newWidth / 2;
      const newY = centerY - newHeight / 2;

      // Apply minimum size
      const minSize = 50;
      if (newWidth >= minSize && newHeight >= minSize) {
        canvas.updateLayer(currentState.selectedLayerId, {
          x: newX,
          y: newY,
          width: newWidth,
          height: newHeight,
          rotation: newRotation,
        });
        onUpdate();
      }
    } else if (currentState.isDragging && currentState.selectedLayerId) {
      // Drag to move
      const clientX = isTouchEvent
        ? e.touches[0].clientX
        : (e as MouseEvent).clientX;
      const clientY = isTouchEvent
        ? e.touches[0].clientY
        : (e as MouseEvent).clientY;
      const canvasPos = displayToCanvas(clientX, clientY);

      const dx = canvasPos.x - startPos.x;
      const dy = canvasPos.y - startPos.y;

      let newX = (startLayerStateRef.x || 0) + dx;
      let newY = (startLayerStateRef.y || 0) + dy;

      const layer = canvas.getLayer(currentState.selectedLayerId);
      if (layer) {
        // Apply snap
        const snapped = applySnap(newX, newY, layer.width, layer.height);
        newX = snapped.x;
        newY = snapped.y;

        // Calculate and emit snap guides
        const tempLayer = { ...layer, x: newX, y: newY };
        const guides = calculateSnapGuides(tempLayer);
        onSnapGuidesChange?.(guides);
      }

      canvas.updateLayer(currentState.selectedLayerId, {
        x: newX,
        y: newY,
      });
      onUpdate();
    }

    // Check if touch count changed (e.g., added second finger)
    if (isTouchEvent && touchCount !== lastTouchCount) {
      if (
        touchCount >= 2 && currentState.isDragging &&
        currentState.selectedLayerId
      ) {
        // Transition from drag to pinch
        const touchInfo = getTouchInfo(e.touches);
        initialPinchDistance = touchInfo.distance;
        initialPinchAngle = touchInfo.angle;

        const layer = canvas.getLayer(currentState.selectedLayerId);
        if (layer) {
          startLayerStateRef = {
            x: layer.x,
            y: layer.y,
            width: layer.width,
            height: layer.height,
            rotation: layer.rotation,
          };
        }

        setState((prev) => ({ ...prev, isDragging: false, isPinching: true }));
      } else if (
        touchCount === 1 && currentState.isPinching &&
        currentState.selectedLayerId
      ) {
        // Transition from pinch to drag
        const canvasPos = displayToCanvas(
          e.touches[0].clientX,
          e.touches[0].clientY,
        );
        startPos = canvasPos;

        const layer = canvas.getLayer(currentState.selectedLayerId);
        if (layer) {
          startLayerStateRef = {
            x: layer.x,
            y: layer.y,
            width: layer.width,
            height: layer.height,
            rotation: layer.rotation,
          };
        }

        setState((prev) => ({ ...prev, isPinching: false, isDragging: true }));
      }
      lastTouchCount = touchCount;
    }
  };

  // Handle pointer/touch up
  const handlePointerUp = () => {
    const currentState = state();

    if (
      currentState.isDrawing && currentDrawingPath && drawingLayerIdRef &&
      canvas
    ) {
      const drawingLayer = canvas.getLayer(drawingLayerIdRef) as DrawingLayer;
      if (drawingLayer) {
        const paths = [...drawingLayer.paths];
        if (!paths.includes(currentDrawingPath)) {
          paths.push(currentDrawingPath);
          canvas.updateLayer(drawingLayerIdRef, { paths });
        }
        onUpdate();
      }
      currentDrawingPath = null;
    }

    // Clear snap guides
    onSnapGuidesChange?.([]);

    setState((prev) => ({
      ...prev,
      isDragging: false,
      isPinching: false,
      isDrawing: false,
    }));

    lastTouchCount = 0;
  };

  // Clear drawing
  const clearDrawing = () => {
    if (!canvas) return;

    const drawingLayer = canvas.getLayers().find((l) => l.type === "drawing");
    if (drawingLayer) {
      canvas.removeLayer(drawingLayer.id);
      drawingLayerIdRef = null;
      onUpdate();
    }
  };

  // Undo last drawing stroke
  const undoDrawing = () => {
    if (!canvas || !drawingLayerIdRef) return;

    const drawingLayer = canvas.getLayer(drawingLayerIdRef) as DrawingLayer;
    if (drawingLayer && drawingLayer.paths.length > 0) {
      const paths = drawingLayer.paths.slice(0, -1);
      canvas.updateLayer(drawingLayerIdRef, { paths });
      onUpdate();
    }
  };

  // Handle mouse wheel for resize (PC) or rotate (Shift + wheel)
  const handleWheel = (e: WheelEvent) => {
    const currentState = state();
    if (
      !canvas || !currentState.selectedLayerId || currentState.mode === "draw"
    ) return;

    const layer = canvas.getLayer(currentState.selectedLayerId);
    if (!layer || layer.type === "background") return;

    e.preventDefault();

    const delta = e.deltaY > 0 ? -1 : 1;

    if (e.shiftKey) {
      // Shift + wheel = rotate
      const rotationStep = 5; // degrees per scroll
      const newRotation = (layer.rotation + delta * rotationStep) % 360;
      canvas.updateLayer(currentState.selectedLayerId, {
        rotation: newRotation,
      });
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

      canvas.updateLayer(currentState.selectedLayerId, {
        x: newX,
        y: newY,
        width: newWidth,
        height: newHeight,
      });
    }

    onUpdate();
  };

  // Add event listeners
  createEffect(() => {
    const onMove = (e: MouseEvent | TouchEvent) => {
      const currentState = state();
      if (
        currentState.isDragging || currentState.isPinching ||
        currentState.isDrawing
      ) {
        e.preventDefault();
        handlePointerMove(e);
      }
    };

    const onUp = () => {
      const currentState = state();
      if (
        currentState.isDragging || currentState.isPinching ||
        currentState.isDrawing
      ) {
        handlePointerUp();
      }
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onUp);

    onCleanup(() => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
    });
  });

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
