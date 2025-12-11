import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

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
  style?: CSSProperties;
  className?: string;
};

export default function StoryCanvas(props: Props) {
  const { width, height } = props.data.size;
  const pxToPct = (v: number, total: number) => `${(v / total) * 100}%`;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [layout, setLayout] = useState({ width, height });

  const updateLayout = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    setLayout((prev) =>
      prev.width !== rect.width || prev.height !== rect.height ? { width: rect.width, height: rect.height } : prev,
    );
  }, []);

  useEffect(() => {
    updateLayout();
    const container = containerRef.current;
    if (typeof ResizeObserver !== "undefined" && container) {
      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width: nextWidth, height: nextHeight } = entry.contentRect;
          if (!nextWidth || !nextHeight) continue;
          setLayout((prev) =>
            prev.width !== nextWidth || prev.height !== nextHeight ? { width: nextWidth, height: nextHeight } : prev,
          );
        }
      });
      observer.observe(container);
      return () => observer.disconnect();
    }
    if (typeof window !== "undefined") {
      window.addEventListener("resize", updateLayout);
      return () => window.removeEventListener("resize", updateLayout);
    }
    return undefined;
  }, [updateLayout]);

  const scaleY = useMemo(() => {
    return layout.height > 0 ? layout.height / height : 1;
  }, [height, layout.height]);

  return (
    <div
      ref={(el) => {
        containerRef.current = el;
        updateLayout();
      }}
      className={`relative overflow-hidden ${props.className ?? ""}`}
      style={{
        ...props.style,
        background:
          props.data.backgroundMode === "auto-gradient"
            ? props.data.backgroundGradient || props.data.background || "#000"
            : props.data.backgroundMode === "solid"
              ? props.data.backgroundSolid || props.data.background || "#000"
              : props.data.background || "#000",
        aspectRatio: `${width} / ${height}`,
      }}
    >
      {props.data.backgroundMode === "auto-blur" && props.data.backgroundImageUrl ? (
        <img
          src={props.data.backgroundImageUrl}
          alt=""
          style={{
            position: "absolute",
            inset: "0",
            width: "100%",
            height: "100%",
            objectFit: "cover",
            filter: "blur(30px) saturate(120%)",
            transform: "scale(1.1)",
            opacity: "0.8",
            pointerEvents: "none",
          }}
        />
      ) : null}
      {props.data.elements.map((el) =>
        el.kind === "text" ? (
          <div
            key={el.id}
            style={{
              position: "absolute",
              left: pxToPct(el.x, width),
              top: pxToPct(el.y, height),
              width: el.width ? pxToPct(el.width, width) : undefined,
              height: el.height ? pxToPct(el.height, height) : undefined,
              color: el.color,
              fontSize: `${(el.fontSize * scaleY).toFixed(2)}px`,
              lineHeight: `${(el.fontSize * scaleY * 1.2).toFixed(2)}px`,
              fontWeight: String(el.fontWeight || 400),
              textAlign: el.align || "left",
              opacity: (el as any).opacity ?? 1,
              fontFamily: (el as any).fontFamily || "sans-serif",
              whiteSpace: "pre-wrap",
              wordWrap: "break-word",
              pointerEvents: "none",
            }}
          >
            {el.text}
          </div>
        ) : (
          <img
            key={el.id}
            src={el.url}
            alt=""
            style={{
              position: "absolute",
              left: pxToPct(el.x, width),
              top: pxToPct(el.y, height),
              width: pxToPct(el.width, width),
              height: pxToPct(el.height, height),
              objectFit: el.objectFit || "cover",
              opacity: (el as any).opacity ?? 1,
              transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
              transformOrigin: "center",
            }}
          />
        ),
      )}
    </div>
  );
}
