import { Accessor, children, createSignal, JSX, onCleanup } from "solid-js";

type SwipeTabsProps = {
  index: number | Accessor<number>;
  onIndexChange: (i: number) => void;
  children: JSX.Element | JSX.Element[];
  /** スワイプ確定のしきい値(px) */
  threshold?: number;
  /** コンテナに付与するクラス */
  class?: string;
  /** コンテナに付与するスタイル */
  style?: JSX.CSSProperties;
};

// モバイル横スワイプ用のタブコンテナ。
// ドラッグ中は両方のページを同時に表示し、離したタイミングでスナップします。
export function SwipeTabs(props: SwipeTabsProps) {
  const getIndex =
    () => (typeof props.index === "function"
      ? (props.index as Accessor<number>)()
      : props.index);

  const [dragX, setDragX] = createSignal(0);
  const [isDragging, setIsDragging] = createSignal(false);
  const [startX, setStartX] = createSignal(0);
  const [startY, setStartY] = createSignal(0);
  const [lockedAxis, setLockedAxis] = createSignal<"x" | "y" | null>(null);

  const threshold = () => props.threshold ?? 60;

  let containerRef: HTMLDivElement | undefined;

  const onTouchStart = (e: TouchEvent) => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    setStartX(t.clientX);
    setStartY(t.clientY);
    setDragX(0);
    setLockedAxis(null);
    setIsDragging(true);
  };

  const onTouchMove = (e: TouchEvent) => {
    if (!isDragging()) return;
    const t = e.touches[0];
    const dx = t.clientX - startX();
    const dy = t.clientY - startY();

    // 軸ロック: 最初の少しの移動でX/Yを決定
    if (!lockedAxis()) {
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
        setLockedAxis(Math.abs(dx) > Math.abs(dy) ? "x" : "y");
      }
    }

    if (lockedAxis() === "x") {
      // 横スクロール優先: 縦スクロールを抑制
      e.preventDefault();
      // 端での抵抗
      const idx = getIndex();
      const isAtFirst = idx <= 0 && dx > 0;
      const isAtLast = idx >= (getChildren().length - 1) && dx < 0;
      const resisted = isAtFirst || isAtLast ? dx / 3 : dx;
      setDragX(resisted);
    }
  };

  const onTouchEnd = () => {
    if (!isDragging()) return;
    const dx = dragX();
    const idx = getIndex();
    let next = idx;
    if (Math.abs(dx) > threshold()) {
      next = dx < 0 ? idx + 1 : idx - 1;
    }
    const max = getChildren().length - 1;
    if (next < 0) next = 0;
    if (next > max) next = max;
    setIsDragging(false);
    setDragX(0);
    if (next !== idx) props.onIndexChange(next);
  };

  // 子要素の解決は children() ヘルパ経由で行い、
  // コンポーネントのオーナー配下に計算をぶら下げる（イベント時評価でも安全）
  const resolved = children(() => props.children);
  const getChildren = (): JSX.Element[] => {
    const ch = resolved() as unknown as JSX.Element[];
    return Array.isArray(ch) ? ch : [ch];
  };

  // マウスでも一応動くように(開発時用)
  let mouseDown = false;
  const onMouseDown = (e: MouseEvent) => {
    mouseDown = true;
    setStartX(e.clientX);
    setStartY(e.clientY);
    setDragX(0);
    setLockedAxis(null);
    setIsDragging(true);
  };
  const onMouseMove = (e: MouseEvent) => {
    if (!mouseDown) return;
    const dx = e.clientX - startX();
    const dy = e.clientY - startY();
    if (!lockedAxis()) {
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
        setLockedAxis(Math.abs(dx) > Math.abs(dy) ? "x" : "y");
      }
    }
    if (lockedAxis() === "x") {
      const idx = getIndex();
      const isAtFirst = idx <= 0 && dx > 0;
      const isAtLast = idx >= (getChildren().length - 1) && dx < 0;
      const resisted = isAtFirst || isAtLast ? dx / 3 : dx;
      setDragX(resisted);
    }
  };
  const onMouseUp = () => {
    if (!mouseDown) return;
    mouseDown = false;
    onTouchEnd();
  };

  const addListeners = () => {
    if (!containerRef) return;
    containerRef.addEventListener("touchstart", onTouchStart, {
      passive: true,
    });
    containerRef.addEventListener("touchmove", onTouchMove, { passive: false });
    containerRef.addEventListener("touchend", onTouchEnd, { passive: true });
    containerRef.addEventListener("touchcancel", onTouchEnd, { passive: true });
    containerRef.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };
  const removeListeners = () => {
    if (!containerRef) return;
    containerRef.removeEventListener("touchstart", onTouchStart as any);
    containerRef.removeEventListener("touchmove", onTouchMove as any);
    containerRef.removeEventListener("touchend", onTouchEnd as any);
    containerRef.removeEventListener("touchcancel", onTouchEnd as any);
    containerRef.removeEventListener("mousedown", onMouseDown as any);
    window.removeEventListener("mousemove", onMouseMove as any);
    window.removeEventListener("mouseup", onMouseUp as any);
  };

  // Solidのクリーンアップ
  onCleanup(() => removeListeners());

  // transformスタイル
  const trackStyle = () => {
    const idx = getIndex();
    const px = dragX();
    const translate = `translateX(calc(${-idx * 100}% + ${px}px))`;
    return {
      transform: translate,
      transition: isDragging()
        ? "none"
        : "transform 280ms cubic-bezier(0.22, 0.61, 0.36, 1)",
    } as JSX.CSSProperties;
  };

  return (
    <div
      ref={(el) => {
        containerRef = el;
        // 初期化時にリスナー登録
        addListeners();
      }}
      class={`relative w-full overflow-x-hidden touch-pan-y select-none ${
        props.class ?? ""
      }`}
      role="tablist"
      aria-orientation="horizontal"
      style={props.style}
    >
      <div
        class="flex w-full will-change-transform"
        style={trackStyle()}
      >
        {getChildren().map((child) => (
          <div class="w-full shrink-0 grow-0 basis-full">
            {child}
          </div>
        ))}
      </div>
    </div>
  );
}

export default SwipeTabs;
