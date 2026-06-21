import type { Setter } from "solid-js";
import type { JSX } from "solid-js/jsx-runtime";

type Position = { x: number; y: number };

interface UseVideoTransformArgs {
  enabled: boolean;
  scale: number;
  position: Position;
  rotation: number;
  setScale: Setter<number>;
  setPosition: Setter<Position>;
  setRotation: Setter<number>;
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 3;

export function useVideoTransform(args: UseVideoTransformArgs) {
  // NOTE: `enabled` / `scale` / `position` / `rotation` are passed as REACTIVE
  // getters (the call site uses `get enabled() { ... }`). They must be read
  // off `args` on each access — destructuring them in the parameter list would
  // evaluate each getter exactly ONCE at call time (capturing the initial
  // `enabled=false` while there is no video yet), permanently disabling every
  // drag/zoom/rotate handler. Only the stable setters may be destructured.
  const { setScale, setPosition, setRotation } = args;
  let dragRef: {
    startX: number;
    startY: number;
    startPosX: number;
    startPosY: number;
  } | null = null;
  let pinchRef: {
    startDistance: number;
    startScale: number;
    startAngle: number;
    startRotation: number;
  } | null = null;

  const handlePointerDown: JSX.EventHandler<HTMLDivElement, PointerEvent> = (
    e,
  ) => {
    if (!args.enabled) return;
    e.stopPropagation();

    dragRef = {
      startX: e.clientX,
      startY: e.clientY,
      startPosX: args.position.x,
      startPosY: args.position.y,
    };

    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
  };

  const handlePointerMove: JSX.EventHandler<HTMLDivElement, PointerEvent> = (
    e,
  ) => {
    if (!dragRef || !args.enabled) return;

    const dx = e.clientX - dragRef.startX;
    const dy = e.clientY - dragRef.startY;

    setPosition({
      x: dragRef.startPosX + dx,
      y: dragRef.startPosY + dy,
    });
  };

  const handlePointerUp: JSX.EventHandler<HTMLDivElement, PointerEvent> = (
    e,
  ) => {
    if (!args.enabled) return;
    dragRef = null;
    const target = e.currentTarget as HTMLElement;
    target.releasePointerCapture(e.pointerId);
  };

  const handleWheel: JSX.EventHandler<HTMLDivElement, WheelEvent> = (e) => {
    if (!args.enabled) return;
    e.stopPropagation();

    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setScale((prev) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, prev * delta)));
  };

  const handleTouchStart: JSX.EventHandler<HTMLDivElement, TouchEvent> = (
    e,
  ) => {
    if (e.touches.length === 2 && args.enabled) {
      e.stopPropagation();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx) * (180 / Math.PI);
      pinchRef = {
        startDistance: distance,
        startScale: args.scale,
        startAngle: angle,
        startRotation: args.rotation,
      };
    }
  };

  const handleTouchMove: JSX.EventHandler<HTMLDivElement, TouchEvent> = (e) => {
    if (e.touches.length === 2 && pinchRef && args.enabled) {
      e.stopPropagation();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx) * (180 / Math.PI);

      const nextScale =
        (distance / pinchRef.startDistance) * pinchRef.startScale;
      setScale(Math.max(MIN_SCALE, Math.min(MAX_SCALE, nextScale)));

      const angleDelta = angle - pinchRef.startAngle;
      setRotation(pinchRef.startRotation + angleDelta);
    }
  };

  const handleTouchEnd: JSX.EventHandler<HTMLDivElement, TouchEvent> = () => {
    pinchRef = null;
  };

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
