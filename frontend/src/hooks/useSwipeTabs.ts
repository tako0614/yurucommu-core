import { createSignal, type Accessor } from "../lib/solid-compat";

type SwipeTabsOptions = {
  length: number | Accessor<number>;
  currentIndex: Accessor<number>;
  setIndex: (i: number) => void;
};

export default function useSwipeTabs(options: SwipeTabsOptions) {
  const SWIPE_LOCK_THRESHOLD = 10;
  const SWIPE_RATIO_GUARD = 1.08;
  const SWIPE_FLICK_VELOCITY = 0.35;
  const EDGE_RESISTANCE_K = 120;

  const [dragging, setDragging] = createSignal(false);
  const [dragPx, setDragPx] = createSignal(0);

  let host: HTMLElement | null = null;   // ← スワイプ起点を保持
  let pointerId: number | null = null;
  let pointerType: PointerEvent["pointerType"] | "" = "";
  let startX = 0, startY = 0, startT = 0;
  let lock: "x" | "y" | null = null;
  let startIndex = 0;
  let widthPx = 0;

  const resolveLength = () => {
    const raw =
      typeof options.length === "function"
        ? (options.length as Accessor<number>)()
        : options.length;
    if (!Number.isFinite(raw)) return 0;
    return Math.max(0, Math.floor(raw));
  };

  const attachHost = (el: HTMLElement | null) => {
    if (host && host !== el) reset();
    host = el;
    if (!host) return;
    // 直接プロパティで適用（上書き事故を防ぐ）
    host.style.touchAction = "pan-y";           // 横はアプリ側、縦はUA
    (host.style as any).overscrollBehaviorX = "contain";
    // Safari対策の保険（任意）：タップ強調を抑制
    (host.style as any).webkitTapHighlightColor = "transparent";
  };

  const reset = () => {
    // capture は host に対して現在の pointerId で安全に解放
    if (host && pointerId != null) {
      try { host.releasePointerCapture(pointerId); } catch {}
    }
    pointerId = null; startX = startY = startT = 0;
    pointerType = "";
    lock = null; setDragging(false); setDragPx(0); widthPx = 0;
  };

  const onDown = (e: PointerEvent) => {
    if (e.pointerType === "mouse" && (e as any).button !== 0) return;
    pointerType = e.pointerType || "";
    pointerId = e.pointerId;
    startX = e.clientX; startY = e.clientY; startT = performance.now();
    const length = resolveLength();
    const maxIndex = Math.max(0, length - 1);
    startIndex = Math.max(0, Math.min(options.currentIndex(), maxIndex));
    widthPx = Math.max(host?.getBoundingClientRect().width ?? 0, 1);
    lock = null;
    if (pointerType !== "mouse") {
      host?.setPointerCapture?.(e.pointerId);
    }
  };

  const onMove = (e: PointerEvent) => {
    if (pointerId !== e.pointerId) return;
    const dxRaw = e.clientX - startX;
    const dy = e.clientY - startY;

    if (!lock) {
      const ax = Math.abs(dxRaw), ay = Math.abs(dy);
      if (ax < SWIPE_LOCK_THRESHOLD && ay < SWIPE_LOCK_THRESHOLD) return;
      if (ax > ay * SWIPE_RATIO_GUARD) { lock = "x"; setDragging(true); }
      else if (ay > ax * SWIPE_RATIO_GUARD) { lock = "y"; return; }
      else return;
    }
    if (lock !== "x") return;

    const length = resolveLength();
    const atFirst = startIndex === 0;
    const atLast = startIndex === length - 1;
    let dx = dxRaw;
    if ((atFirst && dx > 0) || (atLast && dx < 0)) {
      dx = dx / (1 + Math.abs(dx) / EDGE_RESISTANCE_K);
    }
    setDragPx(dx);
  };

  const onEnd = (e: PointerEvent) => {
    if (pointerId !== e.pointerId) return reset();
    const dx = dragPx();
    const dt = Math.max(1, performance.now() - startT);
    const vx = dx / dt;
    const switchPx = Math.min(80, widthPx * 0.22);
    const shouldSwitch = Math.abs(dx) >= switchPx || Math.abs(vx) >= SWIPE_FLICK_VELOCITY;

    const length = resolveLength();
    if (lock === "x" && shouldSwitch) {
      if (dx < 0 && startIndex < length - 1) { options.setIndex(startIndex + 1); }
      else if (dx > 0 && startIndex > 0) { options.setIndex(startIndex - 1); }
    }
    
    // Prevent accidental clicks when user performed a drag gesture
    if (pointerType !== "mouse" && lock === "x" && Math.abs(dx) > 5) {
      const preventClick = (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
        host?.removeEventListener('click', preventClick, true);
      };
      host?.addEventListener('click', preventClick, true);
      setTimeout(() => host?.removeEventListener('click', preventClick, true), 100);
    }
    reset();
  };

  const onCancelOrLost = () => reset(); // ← IDを見ずに確実にリセット

  const sliderTransform = () => {
    const length = Math.max(1, resolveLength());
    const current = options.currentIndex();
    const clamped = Math.max(0, Math.min(current, length - 1));
    const unit = 100 / length;
    const base = -clamped * unit;
    if (!dragging()) return `translate3d(${base}%,0,0)`;
    const delta = (dragPx() / Math.max(widthPx, 1)) * unit;
    const min = -(length - 1) * unit;
    const next = Math.max(Math.min(base + delta, 0), min);
    return `translate3d(${next}%,0,0)`;
  };

  // 呼び出し側で <div {...handlers} ref={attachHost} /> のように使う
  const handlers = {
    onPointerDown: onDown,
    onPointerMove: onMove,
    onPointerUp: onEnd,
    onPointerCancel: onCancelOrLost,
    onLostPointerCapture: onCancelOrLost,
  } as const;

  return { dragging, sliderTransform, handlers, ref: attachHost } as const;
}
