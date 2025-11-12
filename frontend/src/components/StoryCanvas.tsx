import { For, createSignal, onCleanup, onMount } from "solid-js";
import type { JSX } from "solid-js/jsx-runtime";

// Canvas data types
export type CanvasSize = { width: number; height: number };

export type TextElement = {
  kind: "text";
  id: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  text: string;
  fontSize: number;
  color: string;
  fontWeight?: number;
  align?: "left" | "center" | "right";
};

export type ImageElement = {
  kind: "image";
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  url: string;
  objectFit?: "cover" | "contain";
  rotation?: number;
};

export type CanvasData = {
  size: CanvasSize;
  background?: string;
  backgroundMode?: "solid" | "auto-gradient" | "auto-blur";
  backgroundSolid?: string;
  backgroundGradient?: string;
  backgroundImageUrl?: string;
  elements: (TextElement | ImageElement)[];
};

type Props = {
  data: CanvasData;
  // CSS size for display. Content scales from 1080x1920 to fit.
  style?: JSX.CSSProperties;
  class?: string;
};

export default function StoryCanvas(props: Props) {
  const { width, height } = props.data.size;
  const pxToPct = (v: number, total: number) => `${(v / total) * 100}%`;

  let containerRef: HTMLDivElement | undefined;
  const [layout, setLayout] = createSignal({ width, height });

  const updateLayout = () => {
    if (!containerRef) return;
    const rect = containerRef.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    setLayout((prev) =>
      prev.width !== rect.width || prev.height !== rect.height
        ? { width: rect.width, height: rect.height }
        : prev,
    );
  };

  onMount(() => {
    updateLayout();
    if (typeof ResizeObserver !== "undefined" && containerRef) {
      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width: nextWidth, height: nextHeight } = entry.contentRect;
          if (!nextWidth || !nextHeight) continue;
          setLayout((prev) =>
            prev.width !== nextWidth || prev.height !== nextHeight
              ? { width: nextWidth, height: nextHeight }
              : prev,
          );
        }
      });
      observer.observe(containerRef);
      onCleanup(() => observer.disconnect());
      return;
    }
    if (typeof window !== "undefined") {
      window.addEventListener("resize", updateLayout);
      onCleanup(() => window.removeEventListener("resize", updateLayout));
    }
  });

  const scaleY = () => {
    const current = layout();
    return current.height > 0 ? current.height / height : 1;
  };

  return (
    <div
      ref={(el) => {
        containerRef = el ?? undefined;
        updateLayout();
      }}
      class={"relative overflow-hidden " + (props.class || "")}
      style={{
        ...props.style,
        background: props.data.backgroundMode === "auto-gradient"
          ? (props.data.backgroundGradient || props.data.background || "#000")
          : props.data.backgroundMode === "solid"
          ? (props.data.backgroundSolid || props.data.background || "#000")
          : (props.data.background || "#000"),
        "aspect-ratio": `${width} / ${height}`,
      }}
    >
      {/* Auto-blur background layer */}
      {props.data.backgroundMode === "auto-blur" &&
          props.data.backgroundImageUrl
        ? (
          <img
            src={props.data.backgroundImageUrl}
            alt=""
            style={{
              position: "absolute",
              inset: "0",
              width: "100%",
              height: "100%",
              "object-fit": "cover",
              filter: "blur(30px) saturate(120%)",
              transform: "scale(1.1)",
              opacity: "0.8",
              "pointer-events": "none",
            }}
          />
        )
        : null}
      <For each={props.data.elements}>
        {(el) => (
          el.kind === "text"
            ? (
              <div
                style={{
                  position: "absolute",
                  left: pxToPct(el.x, width),
                  top: pxToPct(el.y, height),
                  width: el.width ? pxToPct(el.width, width) : undefined,
                  height: el.height ? pxToPct(el.height, height) : undefined,
                  color: el.color,
                  "font-size": `${(el.fontSize * scaleY()).toFixed(2)}px`,
                  "line-height": `${(el.fontSize * scaleY() * 1.2).toFixed(2)}px`,
                  "font-weight": String(el.fontWeight || 400),
                  "text-align": el.align || "left",
                  opacity: (el as any).opacity ?? 1,
                  "font-family": (el as any).fontFamily || "sans-serif",
                  "white-space": "pre-wrap",
                  "word-wrap": "break-word",
                  "pointer-events": "none",
                }}
              >
                {el.text}
              </div>
            )
            : (
              <img
                src={el.url}
                alt=""
                style={{
                  position: "absolute",
                  left: pxToPct(el.x, width),
                  top: pxToPct(el.y, height),
                  width: pxToPct(el.width, width),
                  height: pxToPct(el.height, height),
                  "object-fit": el.objectFit || "cover",
                  opacity: (el as any).opacity ?? 1,
                  transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
                  "transform-origin": "center",
                }}
              />
            )
        )}
      </For>
    </div>
  );
}
