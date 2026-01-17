import type { Dispatch, PointerEvent, SetStateAction, TouchEvent, WheelEvent } from 'react';
import { useCallback, useRef } from 'react';

type Position = { x: number; y: number };

interface UseVideoTransformArgs {
  enabled: boolean;
  scale: number;
  position: Position;
  rotation: number;
  setScale: Dispatch<SetStateAction<number>>;
  setPosition: Dispatch<SetStateAction<Position>>;
  setRotation: Dispatch<SetStateAction<number>>;
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 3;

export function useVideoTransform({
  enabled,
  scale,
  position,
  rotation,
  setScale,
  setPosition,
  setRotation,
}: UseVideoTransformArgs) {
  const dragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null);
  const pinchRef = useRef<{ startDistance: number; startScale: number; startAngle: number; startRotation: number } | null>(null);

  const handlePointerDown = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (!enabled) return;
    e.stopPropagation();

    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startPosX: position.x,
      startPosY: position.y,
    };

    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
  }, [enabled, position.x, position.y]);

  const handlePointerMove = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || !enabled) return;

    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;

    setPosition({
      x: dragRef.current.startPosX + dx,
      y: dragRef.current.startPosY + dy,
    });
  }, [enabled, setPosition]);

  const handlePointerUp = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (!enabled) return;
    dragRef.current = null;
    const target = e.currentTarget as HTMLElement;
    target.releasePointerCapture(e.pointerId);
  }, [enabled]);

  const handleWheel = useCallback((e: WheelEvent<HTMLDivElement>) => {
    if (!enabled) return;
    e.stopPropagation();

    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setScale(prev => Math.max(MIN_SCALE, Math.min(MAX_SCALE, prev * delta)));
  }, [enabled, setScale]);

  const handleTouchStart = useCallback((e: TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2 && enabled) {
      e.stopPropagation();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx) * (180 / Math.PI);
      pinchRef.current = {
        startDistance: distance,
        startScale: scale,
        startAngle: angle,
        startRotation: rotation,
      };
    }
  }, [enabled, rotation, scale]);

  const handleTouchMove = useCallback((e: TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2 && pinchRef.current && enabled) {
      e.stopPropagation();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx) * (180 / Math.PI);

      const nextScale = (distance / pinchRef.current.startDistance) * pinchRef.current.startScale;
      setScale(Math.max(MIN_SCALE, Math.min(MAX_SCALE, nextScale)));

      const angleDelta = angle - pinchRef.current.startAngle;
      setRotation(pinchRef.current.startRotation + angleDelta);
    }
  }, [enabled, setRotation, setScale]);

  const handleTouchEnd = useCallback(() => {
    pinchRef.current = null;
  }, []);

  return {
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleWheel,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
  };
}
