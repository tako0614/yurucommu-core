import { createSignal } from "solid-js";
import type { StoryCanvas, TextLayer } from "../../../lib/story-canvas.ts";
import type { TextData } from "../TextEditorModal.tsx";

interface UseStoryTextEditorOptions {
  storyCanvas: StoryCanvas | null;
  selectLayer: (id: string | null) => void;
  onUpdate: () => void;
}

export function useStoryTextEditor(opts: UseStoryTextEditorOptions) {
  const [isTextEditorOpen, setIsTextEditorOpen] = createSignal(false);
  const [editingTextLayerId, setEditingTextLayerId] = createSignal<
    string | null
  >(null);

  const handleAddText = () => {
    setEditingTextLayerId(null);
    setIsTextEditorOpen(true);
  };

  const handleEditText = (layerId: string) => {
    setEditingTextLayerId(layerId);
    setIsTextEditorOpen(true);
  };

  const getInitialTextData = (): TextData | undefined => {
    const layerId = editingTextLayerId();
    if (!layerId || !opts.storyCanvas) return undefined;
    const layer = opts.storyCanvas.getLayer(layerId);
    if (!layer || layer.type !== "text") return undefined;
    const textLayer = layer as TextLayer;
    return {
      content: textLayer.content,
      fontFamily: textLayer.fontFamily,
      fontSize: textLayer.fontSize,
      fontWeight: textLayer.fontWeight,
      fontStyle: textLayer.fontStyle,
      color: textLayer.color,
      backgroundColor: textLayer.backgroundColor,
      textAlign: textLayer.textAlign,
      stroke: textLayer.stroke,
    };
  };

  const handleTextSave = (textData: TextData) => {
    if (!opts.storyCanvas) return;

    const layerId = editingTextLayerId();
    if (layerId) {
      // Update existing layer
      opts.storyCanvas.updateLayer(layerId, {
        content: textData.content,
        fontFamily: textData.fontFamily,
        fontSize: textData.fontSize,
        fontWeight: textData.fontWeight,
        fontStyle: textData.fontStyle,
        color: textData.color,
        backgroundColor: textData.backgroundColor,
        textAlign: textData.textAlign,
        stroke: textData.stroke,
      });
    } else {
      // Create new layer with modal data
      const layer = opts.storyCanvas.createTextLayer();
      layer.content = textData.content;
      layer.fontFamily = textData.fontFamily;
      layer.fontSize = textData.fontSize;
      layer.fontWeight = textData.fontWeight;
      layer.fontStyle = textData.fontStyle;
      layer.color = textData.color;
      layer.backgroundColor = textData.backgroundColor;
      layer.textAlign = textData.textAlign;
      layer.stroke = textData.stroke;
      opts.storyCanvas.addLayer(layer);
      opts.selectLayer(layer.id);
    }
    opts.onUpdate();
    setIsTextEditorOpen(false);
    setEditingTextLayerId(null);
  };

  const handleTextEditorClose = () => {
    setIsTextEditorOpen(false);
    setEditingTextLayerId(null);
  };

  return {
    isTextEditorOpen,
    editingTextLayerId,
    handleAddText,
    handleEditText,
    getInitialTextData,
    handleTextSave,
    handleTextEditorClose,
  };
}
