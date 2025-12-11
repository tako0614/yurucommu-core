import { useCallback, useRef, useState } from "react";

type SwipeTabsOptions = {
  length: number | (() => number);
  currentIndex: () => number;
  setIndex: (i: number) => void;
};

export default function useSwipeTabs(options: SwipeTabsOptions) {
  const SWIPE_LOCK_THRESHOLD = 10;
  const SWIPE_RATIO_GUARD = 1.08;
  const SWIPE_FLICK_VELOCITY = 0.35;
  const EDGE_RESISTANCE_K = 120;

  const [dragging, setDragging] = useState(false);
  const [dragPx, setDragPx] = useState(0);

  const hostRef = useRef<HTMLElement | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const pointerTypeRef = useRef<PointerEvent["pointerType"] | "">("");
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const startTRef = useRef(0);
  const lockRef = useRef<"x" | "y" | null>(null);
  const startIndexRef = useRef(0);
  const widthPxRef = useRef(0);

  const resolveLength = () => {
    const raw = typeof options.length === "function" ? options.length() : options.length;
    if (!Number.isFinite(raw)) return 0;
    return Math.max(0, Math.floor(raw));
  };

  const reset = useCallback(() => {
    const host = hostRef.current;
    if (host && pointerIdRef.current != null) {
      try {
        host.releasePointerCapture(pointerIdRef.current);
      } catch {
        /* ignore */
      }
    }
    pointerIdRef.current = null;
    startXRef.current = 0;
    startYRef.current = 0;
    startTRef.current = 0;
    pointerTypeRef.current = "";
    lockRef.current = null;
    setDragging(false);
    setDragPx(0);
    widthPxRef.current = 0;
  }, []);

  const attachHost = useCallback(
    (el: HTMLElement | null) => {
      if (hostRef.current && hostRef.current !== el) reset();
      hostRef.current = el;
      if (!el) return;
      el.style.touchAction = "pan-y";
      (el.style as any).overscrollBehaviorX = "contain";
      (el.style as any).webkitTapHighlightColor = "transparent";
    },
    [reset],
  );

  const onDown = useCallback(
    (e: PointerEvent) => {
      if (e.pointerType === "mouse" && (e as any).button !== 0) return;
      pointerTypeRef.current = e.pointerType || "";
      pointerIdRef.current = e.pointerId;
      startXRef.current = e.clientX;
      startYRef.current = e.clientY;
      startTRef.current = performance.now();
      const length = resolveLength();
      const maxIndex = Math.max(0, length - 1);
      startIndexRef.current = Math.max(0, Math.min(options.currentIndex(), maxIndex));
      widthPxRef.current = Math.max(hostRef.current?.getBoundingClientRect().width ?? 0, 1);
      lockRef.current = null;
      if (pointerTypeRef.current !== "mouse") {
        hostRef.current?.setPointerCapture?.(e.pointerId);
      }
    },
    [options],
  );

  const onMove = useCallback(
    (e: PointerEvent) => {
      if (pointerIdRef.current !== e.pointerId) return;
      const dxRaw = e.clientX - startXRef.current;
      const dy = e.clientY - startYRef.current;

      if (!lockRef.current) {
        const ax = Math.abs(dxRaw);
        const ay = Math.abs(dy);
        if (ax < SWIPE_LOCK_THRESHOLD && ay < SWIPE_LOCK_THRESHOLD) return;
        if (ax > ay * SWIPE_RATIO_GUARD) {
          lockRef.current = "x";
          setDragging(true);
        } else if (ay > ax * SWIPE_RATIO_GUARD) {
          lockRef.current = "y";
          return;
        } else {
          return;
        }
      }
      if (lockRef.current !== "x") return;

      const length = resolveLength();
      const atFirst = startIndexRef.current === 0;
      const atLast = startIndexRef.current === length - 1;
      let dx = dxRaw;
      if ((atFirst && dx > 0) || (atLast && dx < 0)) {
        dx = dx / (1 + Math.abs(dx) / EDGE_RESISTANCE_K);
      }
      setDragPx(dx);
    },
    [options],
  );

  const onEnd = useCallback(
    (e: PointerEvent) => {
      if (pointerIdRef.current !== e.pointerId) return reset();
      const dx = dragPx;
      const dt = Math.max(1, performance.now() - startTRef.current);
      const vx = dx / dt;
      const switchPx = Math.min(80, widthPxRef.current * 0.22);
      const shouldSwitch = Math.abs(dx) >= switchPx || Math.abs(vx) >= SWIPE_FLICK_VELOCITY;

      const length = resolveLength();
      if (lockRef.current === "x" && shouldSwitch) {
        if (dx < 0 && startIndexRef.current < length - 1) {
          options.setIndex(startIndexRef.current + 1);
        } else if (dx > 0 && startIndexRef.current > 0) {
          options.setIndex(startIndexRef.current - 1);
        }
      }

      if (pointerTypeRef.current !== "mouse" && lockRef.current === "x" && Math.abs(dx) > 5) {
        const host = hostRef.current;
        const preventClick = (evt: Event) => {
          evt.preventDefault();
          evt.stopPropagation();
          host?.removeEventListener("click", preventClick, true);
        };
        host?.addEventListener("click", preventClick, true);
        setTimeout(() => host?.removeEventListener("click", preventClick, true), 100);
      }
      reset();
    },
    [options, reset, dragPx],
  );

  const onCancelOrLost = useCallback(() => reset(), [reset]);

  const sliderTransform = useCallback(() => {
    const length = Math.max(1, resolveLength());
    const current = options.currentIndex();
    const clamped = Math.max(0, Math.min(current, length - 1));
    const unit = 100 / length;
    const base = -clamped * unit;
    if (!dragging) return `translate3d(${base}%,0,0)`;
    const delta = (dragPx / Math.max(widthPxRef.current, 1)) * unit;
    const min = -(length - 1) * unit;
    const next = Math.max(Math.min(base + delta, 0), min);
    return `translate3d(${next}%,0,0)`;
  }, [dragPx, dragging, options]);

  const handlers = {
    onPointerDown: onDown,
    onPointerMove: onMove,
    onPointerUp: onEnd,
    onPointerCancel: onCancelOrLost,
    onLostPointerCapture: onCancelOrLost,
  } as const;

  return { dragging, sliderTransform, handlers, ref: attachHost } as const;
}
