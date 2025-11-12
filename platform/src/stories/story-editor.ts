import type {
  CanvasData,
  CanvasSize,
  ImageElement,
  TextElement,
} from "./story-schema";

export type StoryEditorElement = TextElement | ImageElement;

export type StoryEditorOptions = {
  canvasSize?: CanvasSize;
  initialElements?: StoryEditorElement[];
  initialDurationMs?: number;
  initialBackgroundMode?: CanvasData["backgroundMode"];
  initialBackgroundSolid?: string;
  initialBackgroundGradient?: string;
  initialBackgroundImageUrl?: string;
  idFactory?: () => string;
  minElementSize?: number;
  maxImageDimension?: number;
};

export type StoryEditorSnapshot = {
  canvas: CanvasData;
  elements: StoryEditorElement[];
  selectedId: string | null;
  durationMs: number;
  backgroundMode: CanvasData["backgroundMode"];
  backgroundSolid: string;
  backgroundGradient?: string;
  backgroundImageUrl?: string;
};

export type StoryEditorPublishPayload = {
  canvas: CanvasData;
  durationMs?: number;
};

type Listener = (snapshot: StoryEditorSnapshot) => void;

type ImagePlacementOptions = {
  width: number;
  height: number;
  objectFit?: ImageElement["objectFit"];
  id?: string;
  makeBackgroundCandidate?: boolean;
  maxDimension?: number;
  minSize?: number;
};

function defaultIdFactory() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2, 10);
}

function cloneElement<T extends StoryEditorElement>(element: T): T {
  return { ...element } as T;
}

export class StoryEditor {
  private readonly canvasSize: CanvasSize;
  private elements: StoryEditorElement[];
  private selectedId: string | null;
  private durationMs: number;
  private backgroundMode: CanvasData["backgroundMode"];
  private backgroundSolid: string;
  private backgroundGradient?: string;
  private backgroundImageUrl?: string;
  private readonly listeners = new Set<Listener>();
  private readonly idFactory: () => string;
  private readonly minElementSize: number;
  private readonly maxImageDimension: number;

  constructor(options: StoryEditorOptions = {}) {
    this.canvasSize = options.canvasSize ?? { width: 1080, height: 1920 };
    this.elements = options.initialElements?.map(cloneElement) ?? [];
    this.selectedId = this.elements.length ? this.elements[0].id : null;
    this.durationMs = options.initialDurationMs ?? 5000;
    this.backgroundMode = options.initialBackgroundMode ?? "auto-gradient";
    this.backgroundSolid = options.initialBackgroundSolid ?? "#0f172a";
    this.backgroundGradient = options.initialBackgroundGradient;
    this.backgroundImageUrl = options.initialBackgroundImageUrl;
    this.idFactory = options.idFactory ?? defaultIdFactory;
    this.minElementSize = options.minElementSize ?? 48;
    this.maxImageDimension = options.maxImageDimension ?? 1280;

    this.ensureBackgroundImageCandidate();
    this.emit();
  }

  static buildRadialGradient(start: string, end: string) {
    return `radial-gradient(120% 120% at 30% 20%, ${start} 0%, ${end} 65%, #000000 100%)`;
  }

  static deriveImagePlacement(
    canvas: CanvasSize,
    width: number,
    height: number,
    options?: { minSize?: number; maxDimension?: number },
  ) {
    const minSize = options?.minSize ?? 48;
    const maxDimension = options?.maxDimension ?? Math.max(canvas.width, canvas.height);
    const safeWidth = width > 0 ? width : canvas.width;
    const safeHeight = height > 0 ? height : canvas.height;
    
    // Calculate the original aspect ratio
    const aspectRatio = safeWidth / safeHeight;
    
    // Scale based on the larger dimension
    const maxInput = Math.max(safeWidth, safeHeight);
    let scaleFactor = maxInput > 0 ? Math.min(1, maxDimension / maxInput) : 1;
    
    // Apply initial scaling
    let scaledWidth = Math.round(safeWidth * scaleFactor);
    let scaledHeight = Math.round(safeHeight * scaleFactor);
    
    // Ensure dimensions fit within canvas bounds while maintaining aspect ratio
    const maxWidth = Math.floor(canvas.width * 0.9);
    const maxHeight = Math.floor(canvas.height * 0.9);
    
    if (scaledWidth > maxWidth) {
      scaledWidth = maxWidth;
      scaledHeight = Math.round(scaledWidth / aspectRatio);
    }
    
    if (scaledHeight > maxHeight) {
      scaledHeight = maxHeight;
      scaledWidth = Math.round(scaledHeight * aspectRatio);
    }
    
    // Ensure minimum size while maintaining aspect ratio
    if (scaledWidth < minSize) {
      scaledWidth = minSize;
      scaledHeight = Math.round(scaledWidth / aspectRatio);
    }
    
    if (scaledHeight < minSize) {
      scaledHeight = minSize;
      scaledWidth = Math.round(scaledHeight * aspectRatio);
    }
    
    const finalWidth = scaledWidth;
    const finalHeight = scaledHeight;
    const x = Math.round((canvas.width - finalWidth) / 2);
    const y = Math.round((canvas.height - finalHeight) / 2);
    return { x, y, width: finalWidth, height: finalHeight };
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): StoryEditorSnapshot {
    return {
      canvas: this.buildCanvas(),
      elements: this.elements.map(cloneElement),
      selectedId: this.selectedId,
      durationMs: this.durationMs,
      backgroundMode: this.backgroundMode,
      backgroundSolid: this.backgroundSolid,
      backgroundGradient: this.backgroundGradient,
      backgroundImageUrl: this.backgroundImageUrl,
    };
  }

  getCanvasSize(): CanvasSize {
    return { ...this.canvasSize };
  }

  setDurationMs(value: number) {
    if (!Number.isFinite(value)) return;
    const next = Math.max(0, Math.round(value));
    if (this.durationMs === next) return;
    this.durationMs = next;
    this.emit();
  }

  selectElement(id: string | null) {
    const next = id && this.elements.some((element) => element.id === id) ? id : null;
    if (this.selectedId === next) return;
    this.selectedId = next;
    this.emit();
  }

  addTextElement(initial?: Partial<Omit<TextElement, "kind" | "id">> & { id?: string }) {
    const id = initial?.id ?? this.idFactory();
    const element: TextElement = {
      kind: "text",
      id,
      x: initial?.x ?? Math.round(this.canvasSize.width * 0.1),
      y: initial?.y ?? Math.round(this.canvasSize.height * 0.08),
      width: initial?.width ?? Math.round(this.canvasSize.width * 0.6),
      height: initial?.height ?? Math.round((initial?.fontSize ?? 64) * 1.5),
      text: initial?.text ?? "",
      fontSize: initial?.fontSize ?? 64,
      color: initial?.color ?? "#ffffff",
      fontWeight: initial?.fontWeight,
      align: initial?.align,
      opacity: initial?.opacity,
      fontFamily: initial?.fontFamily,
    };
    this.elements = [...this.elements, element];
    this.selectedId = id;
    this.emit();
    return element;
  }

  addImageElement(options: ImagePlacementOptions & { url: string }) {
    const placement = StoryEditor.deriveImagePlacement(this.canvasSize, options.width, options.height, {
      minSize: options.minSize ?? this.minElementSize,
      maxDimension: options.maxDimension ?? this.maxImageDimension,
    });
    const element: ImageElement = {
      kind: "image",
      id: options.id ?? this.idFactory(),
      url: options.url,
      x: placement.x,
      y: placement.y,
      width: placement.width,
      height: placement.height,
      objectFit: options.objectFit ?? "contain",
      opacity: 1,
      rotation: 0,
    };
    this.elements = [...this.elements, element];
    this.selectedId = element.id;
    if (options.makeBackgroundCandidate && !this.backgroundImageUrl) {
      this.backgroundImageUrl = element.url;
    }
    this.ensureBackgroundImageCandidate();
    this.emit();
    return element;
  }

  updateElement(id: string, updates: Partial<TextElement> | Partial<ImageElement>) {
    let changed = false;
    this.elements = this.elements.map((element) => {
      if (element.id !== id) {
        return element;
      }
      changed = true;
      return { ...element, ...updates } as StoryEditorElement;
    });
    if (!changed) return;
    this.emit();
  }

  removeElement(id: string) {
    const before = this.elements.length;
    this.elements = this.elements.filter((element) => element.id !== id);
    if (this.elements.length === before) return;
    if (this.selectedId === id) {
      this.selectedId = this.elements.length ? this.elements[this.elements.length - 1].id : null;
    }
    this.ensureBackgroundImageCandidate();
    this.emit();
  }

  bringElementToFront(id: string) {
    const index = this.elements.findIndex((element) => element.id === id);
    if (index === -1 || index === this.elements.length - 1) return;
    const [element] = this.elements.splice(index, 1);
    this.elements = [...this.elements, element];
    this.emit();
  }

  sendElementToBack(id: string) {
    const index = this.elements.findIndex((element) => element.id === id);
    if (index <= 0) return;
    const [element] = this.elements.splice(index, 1);
    this.elements = [element, ...this.elements];
    this.emit();
  }

  setBackgroundMode(mode: CanvasData["backgroundMode"]) {
    if (this.backgroundMode === mode) return;
    this.backgroundMode = mode;
    if (mode !== "auto-blur") {
      this.backgroundImageUrl = mode === "auto-gradient" ? this.backgroundImageUrl : undefined;
    }
    if (mode === "auto-blur") {
      this.ensureBackgroundImageCandidate();
    }
    this.emit();
  }

  setBackgroundSolid(color: string) {
    if (this.backgroundSolid === color) return;
    this.backgroundSolid = color;
    this.emit();
  }

  setBackgroundGradient(gradient: string | undefined) {
    if (this.backgroundGradient === gradient) return;
    this.backgroundGradient = gradient;
    this.emit();
  }

  setBackgroundImage(url: string | undefined) {
    if (this.backgroundImageUrl === url) return;
    this.backgroundImageUrl = url;
    this.emit();
  }

  replaceElements(next: StoryEditorElement[]) {
    this.elements = next.map(cloneElement);
    this.selectedId = this.elements.length ? this.elements[this.elements.length - 1].id : null;
    this.ensureBackgroundImageCandidate();
    this.emit();
  }

  serialize(): StoryEditorPublishPayload {
    return {
      canvas: this.buildCanvas(),
      durationMs: this.durationMs || undefined,
    };
  }

  private buildCanvas(): CanvasData {
    const background = this.backgroundMode === "solid"
      ? this.backgroundSolid
      : this.backgroundMode === "auto-gradient"
        ? this.backgroundGradient ?? this.backgroundSolid
        : this.backgroundSolid;

    return {
      size: { ...this.canvasSize },
      background,
      backgroundMode: this.backgroundMode,
      backgroundSolid: this.backgroundSolid,
      backgroundGradient:
        this.backgroundMode === "auto-gradient" ? this.backgroundGradient ?? undefined : undefined,
      backgroundImageUrl:
        this.backgroundMode === "auto-blur" ? this.backgroundImageUrl ?? undefined : undefined,
      elements: this.elements.map(cloneElement),
    };
  }

  private ensureBackgroundImageCandidate() {
    if (this.backgroundMode !== "auto-blur") {
      if (this.backgroundImageUrl && !this.hasImageWithUrl(this.backgroundImageUrl)) {
        this.backgroundImageUrl = undefined;
      }
      return;
    }
    if (this.backgroundImageUrl && this.hasImageWithUrl(this.backgroundImageUrl)) {
      return;
    }
    const next = this.elements.find((element) => element.kind === "image") as ImageElement | undefined;
    this.backgroundImageUrl = next?.url;
  }

  private hasImageWithUrl(url: string) {
    return this.elements.some((element) => element.kind === "image" && element.url === url);
  }

  private emit() {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}

export default StoryEditor;
