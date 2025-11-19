import {
  For,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import type {
  CanvasData,
  ImageElement,
  Story,
  StoryItem,
  TextElement,
} from "../lib/stories";
import { createStory, fileToDataUrl } from "../lib/stories";
import { listMyCommunities } from "../lib/api";
import StoryEditor, { type StoryEditorSnapshot } from "@platform/stories/story-editor";
import { CANVAS_EXTENSION_TYPE } from "@takos/platform";

type Props = {
  open: boolean;
  communityId?: string | null;
  onClose: () => void;
  onCreated?: (story: Story) => void;
  initialFiles?: File[];
};

const CANVAS_WIDTH = 1080;
const CANVAS_HEIGHT = 1920;
const MAX_PREVIEW_WIDTH = 42 * 16; // Tailwind max-w-2xl => 42rem
const DEFAULT_OVERLAY_VERTICAL_PADDING = 48; // py-6 top + bottom
const COMPACT_HEIGHT_BREAKPOINT = 1280;
const STACKED_LAYOUT_VERTICAL_BUFFER = 104;

type Elem = ImageElement | TextElement;

export default function StoryComposer(props: Props) {
  const editor = new StoryEditor({
    canvasSize: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
    initialBackgroundMode: "auto-gradient",
    initialBackgroundSolid: "#0f172a",
    initialBackgroundGradient: StoryEditor.buildRadialGradient("#0f172a", "#020617"),
    initialDurationMs: 5000,
  });
  const [editorState, setEditorState] = createSignal<StoryEditorSnapshot>(
    editor.getSnapshot(),
  );
  const unsubscribe = editor.subscribe((snapshot: StoryEditorSnapshot) => setEditorState(snapshot));
  onCleanup(() => unsubscribe());
  const elements = createMemo(() => editorState().elements);
  const selectedId = createMemo(() => editorState().selectedId);
  const [dragging, setDragging] = createSignal<
    { id: string; offsetX: number; offsetY: number } | null
  >(null);
  const [resizing, setResizing] = createSignal<
    {
      id: string;
      handle: "se" | "e" | "s";
      startX: number;
      startY: number;
      startW: number;
      startH: number;
    } | null
  >(null);
  const [posting, setPosting] = createSignal(false);
  const [bgMenuOpen, setBgMenuOpen] = createSignal(false);
  const [audience, setAudience] = createSignal<'all' | 'community'>('all');
  const [communities] = createResource(async () => {
    try {
      return await listMyCommunities();
    } catch {
      return [];
    }
  });
  const [selectedCommunityId, setSelectedCommunityId] = createSignal<string | null>(
    props.communityId ?? null,
  );
  const [showCommunityPicker, setShowCommunityPicker] = createSignal(false);
  const [communityPickerMode, setCommunityPickerMode] =
    createSignal<"idle" | "select" | "publish">("idle");
  const [viewportHeight, setViewportHeight] = createSignal<number>(
    typeof window === "undefined" ? 0 : window.innerHeight,
  );
  const [controlsHeight, setControlsHeight] = createSignal(0);
  const [controlsRef, setControlsRef] = createSignal<HTMLDivElement | undefined>();
  const overlayPadding = createMemo(() => {
    const vh = viewportHeight();
    if (!vh) return DEFAULT_OVERLAY_VERTICAL_PADDING;
    return vh < COMPACT_HEIGHT_BREAKPOINT ? 0 : DEFAULT_OVERLAY_VERTICAL_PADDING;
  });
  const previewSizing = createMemo(() => {
    const vh = viewportHeight();
    if (!vh) return null;
    const padding = overlayPadding();
    const extra = controlsHeight() + STACKED_LAYOUT_VERTICAL_BUFFER;
    const availableHeight = Math.max(0, vh - padding - extra);
    const maxHeight = Math.min(CANVAS_HEIGHT, availableHeight || vh);
    const maxWidthFromHeight = Math.floor((maxHeight * CANVAS_WIDTH) / CANVAS_HEIGHT);
    const maxWidth = Math.min(MAX_PREVIEW_WIDTH, maxWidthFromHeight);
    return { maxHeight, maxWidth };
  });
  const previewStyle = createMemo(() => {
    const sizing = previewSizing();
    return sizing
      ? {
          "max-height": `${sizing.maxHeight}px`,
          "max-width": `${sizing.maxWidth}px`,
        }
      : {};
  });
  const overlayPaddingClass = createMemo(() =>
    viewportHeight() && viewportHeight() < COMPACT_HEIGHT_BREAKPOINT ? "py-0" : "py-6",
  );

  onMount(() => {
    if (typeof window === "undefined") return;
    const updateViewport = () => {
      setViewportHeight(window.innerHeight);
    };
    updateViewport();
    window.addEventListener("resize", updateViewport);
    onCleanup(() => window.removeEventListener("resize", updateViewport));
  });

  createEffect(() => {
    if (!props.open) {
      setControlsHeight(0);
      return;
    }
    if (typeof window === "undefined" || typeof ResizeObserver === "undefined") {
      return;
    }
    const el = controlsRef();
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setControlsHeight(Math.ceil(entry.contentRect.height));
      }
    });
    observer.observe(el);
    setControlsHeight(Math.ceil(el.getBoundingClientRect().height));
    onCleanup(() => observer.disconnect());
  });

  let selectionInitialized = false;

  createEffect(() => {
    if (!props.open) {
      selectionInitialized = false;
      return;
    }

    if (selectionInitialized) {
      return;
    }

    const list = (communities() as { id: string }[]) || [];
    const preferred = props.communityId ?? null;

    if (preferred) {
      setSelectedCommunityId(preferred);
      selectionInitialized = true;
      return;
    }

    if (selectedCommunityId() !== null) {
      selectionInitialized = true;
      return;
    }

    if (list.length) {
      setSelectedCommunityId(list[0].id);
    } else {
      setSelectedCommunityId(null);
    }
    selectionInitialized = true;
  });

  createEffect(() => {
    if (!selectedCommunityId() && audience() === 'community') {
      setAudience('all');
    }
  });

  const communityOptions = createMemo(
    () => ((communities() as { id: string; name?: string }[]) || []).filter(Boolean),
  );
  const isCommunityPublishMode = createMemo(
    () => communityPickerMode() === "publish",
  );
  // Background settings derived from the shared editor
  const bgMode = createMemo(() => editorState().backgroundMode);
  const bg = createMemo(() => editorState().backgroundSolid);
  const bgGradient = createMemo(() => editorState().backgroundGradient || "");
  const bgImageUrl = createMemo(() => editorState().backgroundImageUrl || "");
  const selected = createMemo(() =>
    elements().find((e: any) => e.id === selectedId()) || null
  );
  // For desktop: suppress text selection after actual drag starts
  let suppressSelection = false;
  let startClientX = 0;
  let startClientY = 0;

  // Utility: load image and resolve its natural size
  const loadImage = (url: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });

  // Compute initial placement size preserving original aspect ratio.
  const initialImageRect = (natW: number, natH: number) => {
    // Do not upscale beyond 100% canvas; keep inside canvas with margin
    const maxW = Math.floor(CANVAS_WIDTH * 0.9);
    const maxH = Math.floor(CANVAS_HEIGHT * 0.9);
    const scale = Math.min(1, Math.min(maxW / natW, maxH / natH));
    const w = Math.max(40, Math.floor(natW * scale));
    const h = Math.max(40, Math.floor(natH * scale));
    const x = Math.floor((CANVAS_WIDTH - w) / 2);
    const y = Math.floor((CANVAS_HEIGHT - h) / 2);
    return { x, y, w, h };
  };

  // Seed with initial files as image elements
  createEffect(async () => {
    const files = props.initialFiles;
    if (props.open && files && files.length > 0) {
      const imgs: ImageElement[] = [];
      for (const f of files) {
        if (!f.type.startsWith("image")) continue;
        const url = await fileToDataUrl(f);
        try {
          const img = await loadImage(url);
          const rect = initialImageRect(
            img.naturalWidth || img.width,
            img.naturalHeight || img.height,
          );
          imgs.push({
            kind: "image",
            id: crypto.randomUUID(),
            url,
            x: rect.x,
            y: rect.y,
            width: rect.w,
            height: rect.h,
            objectFit: "contain",
          });
        } catch {
          // fallback to a reasonable 16:9 box if we fail to read image size
          const w = Math.floor(CANVAS_WIDTH * 0.8);
          const h = Math.floor((w * 9) / 16);
          imgs.push({
            kind: "image",
            id: crypto.randomUUID(),
            url,
            x: Math.floor((CANVAS_WIDTH - w) / 2),
            y: Math.floor((CANVAS_HEIGHT - h) / 2),
            width: w,
            height: h,
            objectFit: "contain",
          });
        }
      }
      if (imgs.length > 0) {
        editor.replaceElements(imgs);
      }
    }
  });

  // Auto background computation (from first image element)
  createEffect(() => {
    const firstImg = elements().find((e: any) => (e as any).kind === "image") as
      | ImageElement
      | undefined;
    if (!firstImg) {
      editor.setBackgroundImage(undefined);
      editor.setBackgroundGradient("linear-gradient(180deg, #222, #000)");
      return;
    }
    editor.setBackgroundImage(firstImg.url);
    // Compute a simple average color and build a radial gradient
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = firstImg.url;
      img.onload = () => {
        try {
          const c = document.createElement("canvas");
          const ctx = c.getContext("2d");
          if (!ctx) return;
          const w = 24, h = 24;
          c.width = w;
          c.height = h;
          ctx.drawImage(img, 0, 0, w, h);
          const data = ctx.getImageData(0, 0, w, h).data;
          let r = 0, g = 0, b = 0, n = 0;
          for (let i = 0; i < data.length; i += 4) {
            const a = data[i + 3];
            if (a < 8) continue;
            r += data[i];
            g += data[i + 1];
            b += data[i + 2];
            n++;
          }
          if (n === 0) return;
          r = Math.round(r / n);
          g = Math.round(g / n);
          b = Math.round(b / n);
          const base = `rgb(${r}, ${g}, ${b})`;
          // derive a darker color
          const dark = `rgb(${Math.max(0, r - 40)}, ${Math.max(0, g - 40)}, ${
            Math.max(0, b - 40)
          })`;
          const grad =
            `radial-gradient(120% 120% at 30% 20%, ${base} 0%, ${dark} 60%, #000 100%)`;
          editor.setBackgroundGradient(grad);
        } catch {}
      };
    } catch {}
  });

  const addText = () => {
    editor.addTextElement({
      x: 80,
      y: 200,
      width: 400,
      height: 100,
      text: "テキスト",
      fontSize: 64,
      color: "#000000",
      fontWeight: 700,
      align: "left",
    });
  };

  const onPickImage = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const url = await fileToDataUrl(file);
    try {
      const img = await loadImage(url);
      const rect = initialImageRect(
        img.naturalWidth || img.width,
        img.naturalHeight || img.height,
      );
      editor.addImageElement({
        url,
        width: rect.w,
        height: rect.h,
        objectFit: "contain",
        makeBackgroundCandidate: !bgImageUrl(),
      });
    } catch {
      const w = Math.floor(CANVAS_WIDTH * 0.8);
      const h = Math.floor((w * 9) / 16);
      editor.addImageElement({
        url,
        width: w,
        height: h,
        objectFit: "contain",
        makeBackgroundCandidate: !bgImageUrl(),
      });
    }
    input.value = "";
  };

  const removeSelected = () => {
    const id = selectedId();
    if (!id) return;
    editor.removeElement(id);
  };

  const onPointerDown = (e: PointerEvent, id: string) => {
    // Prevent page scroll on touch while interacting with the canvas
    try {
      if ((e as any).pointerType && (e as any).pointerType !== "mouse") {
        e.preventDefault();
      }
    } catch {}
    suppressSelection = false;
    startClientX = e.clientX;
    startClientY = e.clientY;
    const container = document.getElementById("story-canvas") as
      | HTMLElement
      | null;
    if (!container) return;
    const el = elements().find((el: any) => el.id === id);
    if (!el) return;
    const cr = container.getBoundingClientRect();
    const ratioX = CANVAS_WIDTH / cr.width;
    const ratioY = CANVAS_HEIGHT / cr.height;
    const px = (e.clientX - cr.left) * ratioX;
    const py = (e.clientY - cr.top) * ratioY;
    setDragging({
      id,
      offsetX: px - (el as any).x,
      offsetY: py - (el as any).y,
    });
    editor.selectElement(id);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent) => {
    const drag = dragging();
    const rs = resizing();
    if (!drag && !rs) return;
    const container = document.getElementById("story-canvas") as
      | HTMLElement
      | null;
    if (!container) return;
    const cr = container.getBoundingClientRect();
    const ratioX = CANVAS_WIDTH / cr.width;
    const ratioY = CANVAS_HEIGHT / cr.height;
    if (drag) {
      // If the mouse moved enough, suppress selection on desktop to allow smooth dragging
      if (!suppressSelection && (e as any).pointerType === "mouse") {
        const dx = e.clientX - startClientX;
        const dy = e.clientY - startClientY;
        if (Math.hypot(dx, dy) > 3) {
          try {
            (document.body as any).style.userSelect = "none";
          } catch {}
          suppressSelection = true;
        }
      }
      const mx = (e.clientX - cr.left) * ratioX;
      const my = (e.clientY - cr.top) * ratioY;
      // Measure actual rendered size to keep bounds correct after resize/font-size changes
      const elDef = elements().find((el: any) => el.id === drag.id);
      const dom = document.querySelector(`[data-el-id="${drag.id}"]`) as
        | HTMLElement
        | null;
      const dr = dom?.getBoundingClientRect();
      const elW = dr ? dr.width * ratioX : ((elDef as any)?.width ?? 40);
      const elH = dr ? dr.height * ratioY : ((elDef as any)?.height ?? 40);
      const minVisible = 1;
      const minX = -elW + minVisible;
      const maxX = CANVAS_WIDTH - minVisible;
      const minY = -elH + minVisible;
      const maxY = CANVAS_HEIGHT - minVisible;
      const x = Math.max(minX, Math.min(maxX, mx - drag.offsetX));
      const y = Math.max(minY, Math.min(maxY, my - drag.offsetY));
      editor.updateElement(drag.id, { x, y });
    }
    if (rs) {
      const mx = (e.clientX - cr.left) * ratioX;
      const my = (e.clientY - cr.top) * ratioY;
      const elDef = elements().find((el: any) => el.id === rs.id);
      if (!elDef) return;
      if ((elDef as any).kind === "image") {
        const startW = rs.startW > 0 ? rs.startW : 40;
        const startH = rs.startH > 0 ? rs.startH : 40;
        const deltaWidth = mx - rs.startX;
        const deltaHeight = my - rs.startY;
        const candidateFromWidth = Number.isFinite(startW)
          ? (startW + deltaWidth) / startW
          : Number.NaN;
        const candidateFromHeight = Number.isFinite(startH)
          ? (startH + deltaHeight) / startH
          : Number.NaN;

        let scaleFactor: number;
        if (Number.isFinite(candidateFromWidth) && Number.isFinite(candidateFromHeight)) {
          scaleFactor =
            Math.abs(candidateFromWidth - 1) >= Math.abs(candidateFromHeight - 1)
              ? candidateFromWidth
              : candidateFromHeight;
        } else if (Number.isFinite(candidateFromWidth)) {
          scaleFactor = candidateFromWidth;
        } else if (Number.isFinite(candidateFromHeight)) {
          scaleFactor = candidateFromHeight;
        } else {
          scaleFactor = 1;
        }

        if (!Number.isFinite(scaleFactor) || scaleFactor <= 0) {
          scaleFactor = 1;
        }

        const minScale = Math.max(40 / startW, 40 / startH);
        if (Number.isFinite(minScale) && minScale > 0) {
          scaleFactor = Math.max(scaleFactor, minScale);
        }

        // Ensure the image doesn't exceed canvas bounds while maintaining aspect ratio
        const maxScaleW = CANVAS_WIDTH / startW;
        const maxScaleH = CANVAS_HEIGHT / startH;
        const maxScale = Math.min(maxScaleW, maxScaleH);
        if (Number.isFinite(maxScale) && maxScale > 0) {
          scaleFactor = Math.min(scaleFactor, maxScale);
        }

        const width = startW * scaleFactor;
        const height = startH * scaleFactor;
        editor.updateElement(rs.id, { width, height });
        return;
      }

      const w0 = (elDef as any).width ?? 0;
      const h0 = (elDef as any).height ?? 0;
      let w = w0;
      let h = h0;
      if (rs.handle === "e" || rs.handle === "se") {
        w = Math.max(40, rs.startW + (mx - rs.startX));
      }
      if (rs.handle === "s" || rs.handle === "se") {
        h = Math.max(40, rs.startH + (my - rs.startY));
      }
      editor.updateElement(rs.id, { width: w, height: h });
    }
  };

  const onPointerUp = () => {
    setDragging(null);
    setResizing(null);
    if (suppressSelection) {
      try {
        (document.body as any).style.userSelect = "";
      } catch {}
      suppressSelection = false;
    }
  };

  const handleResize = (
    e: PointerEvent,
    el: Elem,
    handle: "se" | "e" | "s",
  ) => {
    try {
      e.preventDefault();
    } catch {}
    const container = document.getElementById("story-canvas") as
      | HTMLElement
      | null;
    if (!container) return;
    const cr = container.getBoundingClientRect();
    const ratioX = CANVAS_WIDTH / cr.width;
    const ratioY = CANVAS_HEIGHT / cr.height;
    editor.selectElement(el.id);
    setResizing({
      id: el.id,
      handle,
      startX: (e.clientX - cr.left) * ratioX,
      startY: (e.clientY - cr.top) * ratioY,
      startW: (el as any).width || 0,
      startH: (el as any).height || 0,
    });
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  // Compress dataURL images to WebP on publish to reduce payload size
  const compressDataUrl = async (
    url: string,
    opts?: { maxDim?: number; mime?: string; quality?: number },
  ) => {
    const { maxDim = 1920, mime = "image/webp", quality = 0.8 } = opts || {};
    try {
      const img = await loadImage(url);
      const natW = img.naturalWidth || img.width;
      const natH = img.naturalHeight || img.height;
      const scale = Math.min(1, maxDim / Math.max(natW, natH));
      const w = Math.max(1, Math.round(natW * scale));
      const h = Math.max(1, Math.round(natH * scale));
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d");
      if (!ctx) return url;
      ctx.drawImage(img, 0, 0, w, h);
      const out = c.toDataURL(mime, quality);
      // Fallback if encoding failed
      if (!out || typeof out !== "string" || out.length < 32) return url;
      return out;
    } catch {
      return url;
    }
  };

  const publish = async () => {
    if (elements().length === 0) return;
    const communityId = selectedCommunityId();
    setPosting(true);
    try {
      const snapshot = editor.serialize();
      const compressedElements = await Promise.all(
        snapshot.canvas.elements.map(async (el: any) => {
          if ((el as any).kind === "image") {
            const imgEl = el as ImageElement;
            if (imgEl.url.startsWith("data:image/")) {
              const compressed = await compressDataUrl(imgEl.url);
              return { ...imgEl, url: compressed };
            }
          }
          return el;
        }),
      );
      const canvas: CanvasData = {
        ...snapshot.canvas,
        elements: compressedElements,
      };
      const item: StoryItem = {
        type: "extension",
        extensionType: CANVAS_EXTENSION_TYPE,
        payload: { canvas },
        durationMs: snapshot.durationMs ?? 5000,
      };
      const story = await createStory(communityId, [item], {
        audience: communityId ? audience() : 'all',
      });
      props.onCreated?.(story as any);
      editor.replaceElements([]);
      editor.selectElement(null);
      setAudience('all');
      props.onClose();
    } finally {
      setPosting(false);
    }
  };

  const handlePostClick = () => {
    if (posting() || elements().length === 0) return;
    setCommunityPickerMode("publish");
    setShowCommunityPicker(true);
  };

  const handleCommunityPickerOpen = () => {
    if (posting()) return;
    setCommunityPickerMode("select");
    setShowCommunityPicker(true);
  };

  const closeCommunityPicker = () => {
    setShowCommunityPicker(false);
    setCommunityPickerMode("idle");
  };

  const confirmCommunitySelection = async () => {
    const mode = communityPickerMode();

    if (mode === "select") {
      closeCommunityPicker();
      return;
    }

    if (mode !== "publish") {
      closeCommunityPicker();
      return;
    }

    if (posting() || elements().length === 0) {
      closeCommunityPicker();
      return;
    }

    closeCommunityPicker();
    try {
      await publish();
    } catch (error) {
      console.error(error);
      window.alert("投稿に失敗しました。もう一度お試しください。");
    }
  };

  const pct = (v: number, total: number) => `${(v / total) * 100}%`;

  const editableText = (el: TextElement) => (
    <div
      data-el-id={el.id}
      contenteditable
      onInput={(e) => {
        const v = (e.target as HTMLDivElement).textContent || "";
        editor.updateElement(el.id, { text: v });
      }}
      style={{
        position: "absolute",
        left: pct(el.x, CANVAS_WIDTH),
        top: pct(el.y, CANVAS_HEIGHT),
        width: el.width ? pct(el.width, CANVAS_WIDTH) : "auto",
        height: el.height ? pct(el.height, CANVAS_HEIGHT) : "auto",
        color: el.color,
        "font-size": `${(el.fontSize / CANVAS_HEIGHT) * 100}vh`,
        "font-weight": String(el.fontWeight || 400),
        "font-family": (el as any).fontFamily || "sans-serif",
        opacity: (el as any).opacity ?? 1,
        background: "transparent",
        border: selectedId() === el.id ? "2px dashed rgba(0,0,0,0.4)" : "none",
        outline: "none",
        "text-align": el.align || "left",
        "white-space": "pre-wrap",
        "word-wrap": "break-word",
        cursor: "text",
        "user-select": dragging()?.id === el.id ? "none" : undefined,
        "min-width": "20px",
        "min-height": "20px",
        "touch-action": "none",
      }}
      onPointerDown={(ev) =>
        onPointerDown(ev as unknown as PointerEvent, el.id)}
      onPointerMove={(ev) => onPointerMove(ev as unknown as PointerEvent)}
      onPointerUp={() => onPointerUp()}
      onPointerCancel={() => onPointerUp()}
    >
      {el.text}
    </div>
  );

  const imageBox = (el: ImageElement) => (
    <img
      data-el-id={el.id}
      src={el.url}
      alt=""
      draggable={false}
      onDragStart={(ev) => ev.preventDefault()}
      style={{
        position: "absolute",
        left: pct(el.x, CANVAS_WIDTH),
        top: pct(el.y, CANVAS_HEIGHT),
        width: pct(el.width, CANVAS_WIDTH),
        height: pct(el.height, CANVAS_HEIGHT),
        border: selectedId() === el.id ? "2px solid rgba(0,0,255,0.6)" : "none",
        "object-fit": el.objectFit || "cover",
        cursor: "move",
        "user-select": "none",
        "-webkit-user-drag": "none",
        "touch-action": "none",
      }}
      onPointerDown={(ev) =>
        onPointerDown(ev as unknown as PointerEvent, el.id)}
      onPointerMove={(ev) => onPointerMove(ev as unknown as PointerEvent)}
      onPointerUp={() => onPointerUp()}
      onPointerCancel={() => onPointerUp()}
    />
  );

  return (
    <>
      <Show when={props.open}>
        <div
          class={`fixed inset-0 z-50 bg-black/80 flex items-center justify-center px-4 ${overlayPaddingClass()}`}
          onPointerUp={() => onPointerUp()}
          onPointerCancel={() => onPointerUp()}
        >
          <div
            class="relative w-full max-w-2xl"
            onClick={() => setBgMenuOpen(false)}
          >
            <div class="flex flex-col gap-6">
              <div
                class="relative aspect-1080/1920 w-full rounded-4xl bg-black shadow-2xl overflow-hidden mx-auto"
                style={previewStyle()}
              >
                <div class="absolute inset-0 bg-black" />
                <div class="absolute inset-0">
                  <div
                    id="story-canvas"
                    class="relative w-full h-full"
                    style={{
                      background:
                        bgMode() === "auto-gradient"
                          ? bgGradient() || "#000"
                          : bgMode() === "solid"
                          ? bg()
                          : "#000",
                      "touch-action": "none",
                    }}
                    onPointerMove={(ev) =>
                      onPointerMove(ev as unknown as PointerEvent)
                    }
                    onPointerUp={() => onPointerUp()}
                    onPointerCancel={() => onPointerUp()}
                  >
                <Show when={bgMode() === "auto-blur" && !!bgImageUrl()}>
                  <img
                    src={bgImageUrl()}
                    alt=""
                    class="absolute inset-0 w-full h-full object-cover pointer-events-none"
                    style={{
                      filter: "blur(35px) saturate(120%)",
                      transform: "scale(1.12)",
                      opacity: "0.85",
                    }}
                  />
                </Show>
                <For each={elements()}>
                  {(el) => (
                    <>
                      {el.kind === "text"
                        ? editableText(el)
                        : imageBox(el as ImageElement)}
                      <Show when={selectedId() === el.id}>
                        <div
                          class="absolute"
                          style={{
                            left: pct((el as any).x, CANVAS_WIDTH),
                            top: pct((el as any).y, CANVAS_HEIGHT),
                            width: (el as any).width
                              ? pct((el as any).width, CANVAS_WIDTH)
                              : "auto",
                            height: (el as any).height
                              ? pct((el as any).height, CANVAS_HEIGHT)
                              : "auto",
                            "pointer-events": "none",
                          }}
                        >
                          <div
                            class="absolute inset-0 border border-white/80 rounded"
                            style={{ "pointer-events": "none" }}
                          />
                          <Show when={(el as any).width && (el as any).height}>
                            <button
                              class="absolute -right-3 -bottom-3 w-7 h-7 rounded-full bg-white text-black text-lg grid place-items-center shadow"
                              style={{ "pointer-events": "auto" }}
                              onPointerDown={(ev) =>
                                handleResize(
                                  ev as unknown as PointerEvent,
                                  el,
                                  "se",
                                )
                              }
                            >
                              ↘
                            </button>
                            <Show when={el.kind === "text"}>
                              <button
                                class="absolute -right-3 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-white text-black text-lg grid place-items-center shadow"
                                style={{ "pointer-events": "auto" }}
                                onPointerDown={(ev) =>
                                  handleResize(
                                    ev as unknown as PointerEvent,
                                    el,
                                    "e",
                                  )
                                }
                              >
                                ↔
                              </button>
                              <button
                                class="absolute left-1/2 -translate-x-1/2 -bottom-3 w-7 h-7 rounded-full bg-white text-black text-lg grid place-items-center shadow"
                                style={{ "pointer-events": "auto" }}
                                onPointerDown={(ev) =>
                                  handleResize(
                                    ev as unknown as PointerEvent,
                                    el,
                                    "s",
                                  )
                                }
                              >
                                ↕
                              </button>
                            </Show>
                          </Show>
                        </div>
                      </Show>
                    </>
                  )}
                </For>
                  </div>
                </div>

                <div class="absolute inset-x-0 top-0 h-48 bg-linear-to-b from-black/80 via-black/40 to-transparent pointer-events-none" />
                <div class="absolute inset-x-0 bottom-0 h-56 bg-linear-to-t from-black/90 via-black/40 to-transparent pointer-events-none" />

                <div class="absolute top-5 left-5 right-5 flex items-center justify-between text-white">
              <button
                class="w-10 h-10 rounded-full bg-white/20 backdrop-blur flex items-center justify-center"
                onClick={() => {
                  setBgMenuOpen(false);
                  props.onClose();
                }}
                aria-label="閉じる"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  class="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
              <div class="flex items-center gap-2">
                <label class="w-10 h-10 rounded-full bg-white/20 backdrop-blur flex items-center justify-center cursor-pointer">
                  <input
                    type="file"
                    accept="image/*"
                    class="hidden"
                    onChange={onPickImage}
                  />
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    class="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M3 7h3l2-3h8l2 3h3v13H3z" />
                    <circle cx="12" cy="13" r="3" />
                  </svg>
                </label>
                <button
                  class="w-10 h-10 rounded-full bg-white/20 backdrop-blur flex items-center justify-center"
                  onClick={(event) => {
                    event.stopPropagation();
                    setBgMenuOpen((prev) => !prev);
                  }}
                  aria-label="背景を変更"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    class="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15A1.65 1.65 0 0 0 21 13.35V10.6A1.65 1.65 0 0 0 19.4 9L17.7 8 16 4.6A1.65 1.65 0 0 0 14.35 3h-4.7A1.65 1.65 0 0 0 8 4.6L6.3 8 4.6 9A1.65 1.65 0 0 0 3 10.6v2.75A1.65 1.65 0 0 0 4.6 15l1.7 1 1.7 3.4A1.65 1.65 0 0 0 9.65 21h4.7a1.65 1.65 0 0 0 1.65-1.6L17.7 16z" />
                  </svg>
                </button>
                <button
                  class="w-10 h-10 rounded-full bg-white/20 backdrop-blur flex items-center justify-center"
                  onClick={addText}
                  aria-label="テキストを追加"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    class="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M4 7V4h16v3" />
                    <path d="M9 20h6" />
                    <path d="M12 4v16" />
                  </svg>
                </button>
                <Show when={selected()}>
                  <button
                    class="w-10 h-10 rounded-full bg-white/20 backdrop-blur flex items-center justify-center"
                    onClick={(event) => {
                      event.stopPropagation();
                      removeSelected();
                    }}
                    aria-label="削除"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      class="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <path d="M3 6h18" />
                      <path d="M8 6V4h8v2" />
                      <path d="M10 11v6" />
                      <path d="M14 11v6" />
                      <path d="M5 6l1 14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-14" />
                    </svg>
                  </button>
                </Show>
              </div>
            </div>

            <Show when={bgMenuOpen()}>
              <div
                class="absolute right-5 top-20 w-48 rounded-2xl bg-black/80 backdrop-blur text-white text-sm p-3 space-y-2"
                onClick={(event) => event.stopPropagation()}
              >
                <div class="text-xs text-white/60">背景のスタイル</div>
                <button
                  class={`w-full rounded-lg px-3 py-2 text-left ${
                    bgMode() === "auto-gradient"
                      ? "bg-white/20"
                      : "hover:bg-white/10"
                  }`}
                  onClick={() => {
                    editor.setBackgroundMode("auto-gradient");
                    setBgMenuOpen(false);
                  }}
                >
                  自動グラデーション
                </button>
                <button
                  class={`w-full rounded-lg px-3 py-2 text-left ${
                    bgMode() === "auto-blur"
                      ? "bg-white/20"
                      : "hover:bg-white/10"
                  }`}
                  onClick={() => {
                    editor.setBackgroundMode("auto-blur");
                    setBgMenuOpen(false);
                  }}
                >
                  自動ぼかし
                </button>
                <button
                  class={`w-full rounded-lg px-3 py-2 text-left ${
                    bgMode() === "solid"
                      ? "bg-white/20"
                      : "hover:bg-white/10"
                  }`}
                  onClick={() => editor.setBackgroundMode("solid")}
                >
                  単色
                </button>
                <Show when={bgMode() === "solid"}>
                  <div class="flex items-center justify-between">
                    <span class="text-xs text-white/60">色を選択</span>
                    <input
                      type="color"
                      class="w-10 h-10 rounded-full overflow-hidden border border-white/10 bg-transparent"
                      value={bg()}
                      onInput={(event) =>
                        editor.setBackgroundSolid(
                          (event.target as HTMLInputElement).value,
                        )
                      }
                    />
                  </div>
                </Show>
              </div>
            </Show>

            <Show when={selected() && (selected() as any)?.kind === "text"}>
              <div class="absolute inset-x-0 bottom-40 px-6 pointer-events-none">
                <div class="rounded-full bg-black/70 backdrop-blur px-4 py-3 flex items-center gap-3 text-white text-sm pointer-events-auto">
                  <input
                    type="range"
                    min="16"
                    max="128"
                    value={(selected() as any)?.fontSize || 64}
                    class="flex-1 accent-white"
                  onInput={(event) => {
                    const v = Number(
                      (event.target as HTMLInputElement).value,
                    );
                    const id = selectedId();
                    if (id) {
                      editor.updateElement(id, { fontSize: v });
                    }
                  }}
                />
                <input
                  type="color"
                  value={(selected() as any)?.color || "#000000"}
                    class="w-9 h-9 rounded-full overflow-hidden border border-white/20 bg-transparent"
                    onInput={(event) => {
                    const v = (event.target as HTMLInputElement).value;
                    const id = selectedId();
                    if (id) {
                      editor.updateElement(id, { color: v });
                    }
                  }}
                />
                  <select
                    class="bg-white/10 rounded-full px-3 py-1 text-xs"
                    value={(selected() as any)?.align || "left"}
                    onChange={(event) => {
                    const v = (event.target as HTMLSelectElement).value as any;
                    const id = selectedId();
                    if (id) {
                      editor.updateElement(id, { align: v });
                    }
                  }}
                >
                    <option value="left">左寄せ</option>
                    <option value="center">中央</option>
                    <option value="right">右寄せ</option>
                  </select>
                </div>
              </div>
            </Show>

          </div>
          <div
            class="mt-6 w-full max-w-md px-4 sm:px-0 mx-auto"
            onClick={(event) => event.stopPropagation()}
            ref={setControlsRef}
          >
            <div class="rounded-3xl bg-black/70 backdrop-blur px-5 py-5 text-white space-y-4 shadow-lg">
              <div class="flex flex-row flex-wrap items-stretch gap-3">
                <button
                  type="button"
                  class="flex-1 rounded-2xl border border-white/20 bg-white px-5 py-3 text-center text-sm font-semibold text-black transition hover:bg-white/90 focus:outline-none focus:ring-2 focus:ring-white/50 disabled:opacity-70"
                  disabled={
                    posting() ||
                    elements().length === 0
                  }
                  onClick={handlePostClick}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    if (!posting()) handleCommunityPickerOpen();
                  }}
                >
                  {posting() ? '投稿中…' : 'ストーリーズ'}
                </button>
                <div class="flex min-w-[140px] items-center justify-center">
                  <div class="flex overflow-hidden rounded-full border border-white/30">
                    <button
                      type="button"
                      class={`px-4 py-2 text-sm transition focus:outline-none ${
                        audience() === 'all'
                          ? 'bg-white text-black'
                          : 'bg-transparent text-white/70 hover:bg-white/15'
                      }`}
                      onClick={() => setAudience('all')}
                    >
                      公開
                    </button>
                    <button
                      type="button"
                      class={`px-4 py-2 text-sm transition focus:outline-none ${
                        audience() === 'community'
                          ? 'bg-white text-black'
                          : 'bg-transparent text-white/70 hover:bg-white/15'
                      } ${!selectedCommunityId() ? 'opacity-60 cursor-not-allowed' : ''}`}
                      disabled={!selectedCommunityId()}
                      onClick={() => {
                        if (!selectedCommunityId()) return;
                        setAudience('community');
                      }}
                    >
                      非公開
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
      </Show>
      <Show when={showCommunityPicker()}>
        <div
          class="fixed inset-0 z-50 flex items-end justify-center bg-black/70 px-4 pb-10 sm:items-center"
          onClick={closeCommunityPicker}
        >
          <div
            class="w-full max-w-md rounded-3xl bg-white text-black shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div class="px-6 py-6 space-y-5">
              <div class="space-y-1">
                <h2 class="text-lg font-semibold">コミュニティを選択</h2>
                <p class="text-sm text-gray-500">投稿するコミュニティを選んでください。</p>
              </div>
              <div class="space-y-2 max-h-64 overflow-y-auto pr-1">
                <label
                  class="flex items-center justify-between gap-3 rounded-2xl border border-gray-200 px-4 py-3 text-sm hover:border-gray-400"
                  classList={{
                    'border-black bg-black/5': !selectedCommunityId(),
                  }}
                >
                  <div class="flex flex-col">
                    <span class="font-medium">コミュニティなし</span>
                    <span class="text-xs text-gray-500">フォロワー全員に表示されます。</span>
                  </div>
                  <input
                    type="radio"
                    name="story-community"
                    class="h-4 w-4 accent-black"
                    checked={!selectedCommunityId()}
                    onChange={() => setSelectedCommunityId(null)}
                  />
                </label>
                <For each={communityOptions()}>
                  {(community) => (
                    <label
                      class="flex items-center justify-between gap-3 rounded-2xl border border-gray-200 px-4 py-3 text-sm hover:border-gray-400"
                      classList={{
                        'border-black bg-black/5': selectedCommunityId() === community.id,
                      }}
                    >
                      <div class="flex flex-col">
                        <span class="font-medium">{community.name || 'コミュニティ'}</span>
                      </div>
                      <input
                        type="radio"
                        name="story-community"
                        class="h-4 w-4 accent-black"
                        checked={selectedCommunityId() === community.id}
                        onChange={() => setSelectedCommunityId(community.id)}
                      />
                    </label>
                  )}
                </For>
              </div>
              <div class="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  class="rounded-full border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
                  onClick={closeCommunityPicker}
                  disabled={posting()}
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  class="rounded-full bg-black px-5 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  onClick={confirmCommunitySelection}
                  disabled={posting()}
                >
                  {isCommunityPublishMode() ? "投稿する" : "決定"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </Show>
    </>
  );
}
