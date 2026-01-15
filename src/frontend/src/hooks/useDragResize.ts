import { useState, useRef, useCallback, useEffect } from 'react';
import { CanvasElement } from '../types';

interface DragResizeState {
  isDragging: boolean;
  isResizing: boolean;
  resizeHandle: string | null;
}

interface UseDragResizeOptions {
  canvasScale: number;  // Scale factor between display and actual canvas coordinates
  onUpdate: (updates: Partial<CanvasElement>) => void;
}

/**
 * Hook for handling drag and resize interactions on canvas elements
 */
export function useDragResize(
  element: CanvasElement,
  { canvasScale, onUpdate }: UseDragResizeOptions
) {
  const [state, setState] = useState<DragResizeState>({
    isDragging: false,
    isResizing: false,
    resizeHandle: null,
  });

  const startPos = useRef({ x: 0, y: 0 });
  const startElement = useRef<CanvasElement>(element);

  // Update ref when element changes
  useEffect(() => {
    if (!state.isDragging && !state.isResizing) {
      startElement.current = element;
    }
  }, [element, state.isDragging, state.isResizing]);

  const handleMouseDown = useCallback((
    e: React.MouseEvent | React.TouchEvent,
    action: 'drag' | 'resize',
    handle?: string
  ) => {
    e.stopPropagation();
    e.preventDefault();

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    startPos.current = { x: clientX, y: clientY };
    startElement.current = { ...element };

    if (action === 'drag') {
      setState({ isDragging: true, isResizing: false, resizeHandle: null });
    } else {
      setState({ isDragging: false, isResizing: true, resizeHandle: handle || null });
    }
  }, [element]);

  const handleMouseMove = useCallback((e: MouseEvent | TouchEvent) => {
    if (!state.isDragging && !state.isResizing) return;

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    const dx = (clientX - startPos.current.x) / canvasScale;
    const dy = (clientY - startPos.current.y) / canvasScale;

    if (state.isDragging) {
      onUpdate({
        x: startElement.current.x + dx,
        y: startElement.current.y + dy,
      });
    }

    if (state.isResizing && state.resizeHandle) {
      const updates: Partial<CanvasElement> = {};
      const minSize = 50;

      switch (state.resizeHandle) {
        case 'se': // Southeast (bottom-right)
          updates.width = Math.max(minSize, startElement.current.width + dx);
          updates.height = Math.max(minSize, startElement.current.height + dy);
          break;
        case 'sw': // Southwest (bottom-left)
          updates.x = startElement.current.x + dx;
          updates.width = Math.max(minSize, startElement.current.width - dx);
          updates.height = Math.max(minSize, startElement.current.height + dy);
          break;
        case 'ne': // Northeast (top-right)
          updates.y = startElement.current.y + dy;
          updates.width = Math.max(minSize, startElement.current.width + dx);
          updates.height = Math.max(minSize, startElement.current.height - dy);
          break;
        case 'nw': // Northwest (top-left)
          updates.x = startElement.current.x + dx;
          updates.y = startElement.current.y + dy;
          updates.width = Math.max(minSize, startElement.current.width - dx);
          updates.height = Math.max(minSize, startElement.current.height - dy);
          break;
      }

      onUpdate(updates);
    }
  }, [state, canvasScale, onUpdate]);

  const handleMouseUp = useCallback(() => {
    setState({ isDragging: false, isResizing: false, resizeHandle: null });
  }, []);

  // Add/remove global event listeners
  useEffect(() => {
    if (state.isDragging || state.isResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('touchmove', handleMouseMove, { passive: false });
      window.addEventListener('touchend', handleMouseUp);

      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
        window.removeEventListener('touchmove', handleMouseMove);
        window.removeEventListener('touchend', handleMouseUp);
      };
    }
  }, [state.isDragging, state.isResizing, handleMouseMove, handleMouseUp]);

  return {
    isDragging: state.isDragging,
    isResizing: state.isResizing,
    handleMouseDown,
  };
}
