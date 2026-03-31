import { useState, useCallback } from 'react';
import type { StoryCanvas, TextLayer } from '../../../lib/story-canvas.ts';
import type { TextData } from '../TextEditorModal.tsx';

interface UseStoryTextEditorOptions {
  storyCanvas: StoryCanvas | null;
  selectLayer: (id: string | null) => void;
  onUpdate: () => void;
}

export function useStoryTextEditor({
  storyCanvas,
  selectLayer,
  onUpdate,
}: UseStoryTextEditorOptions) {
  const [isTextEditorOpen, setIsTextEditorOpen] = useState(false);
  const [editingTextLayerId, setEditingTextLayerId] = useState<string | null>(null);

  const handleAddText = useCallback(() => {
    setEditingTextLayerId(null);
    setIsTextEditorOpen(true);
  }, []);

  const handleEditText = useCallback((layerId: string) => {
    setEditingTextLayerId(layerId);
    setIsTextEditorOpen(true);
  }, []);

  const getInitialTextData = useCallback((): TextData | undefined => {
    if (!editingTextLayerId || !storyCanvas) return undefined;
    const layer = storyCanvas.getLayer(editingTextLayerId);
    if (!layer || layer.type !== 'text') return undefined;
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
  }, [editingTextLayerId, storyCanvas]);

  const handleTextSave = useCallback((textData: TextData) => {
    if (!storyCanvas) return;

    if (editingTextLayerId) {
      // Update existing layer
      storyCanvas.updateLayer(editingTextLayerId, {
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
      const layer = storyCanvas.createTextLayer();
      layer.content = textData.content;
      layer.fontFamily = textData.fontFamily;
      layer.fontSize = textData.fontSize;
      layer.fontWeight = textData.fontWeight;
      layer.fontStyle = textData.fontStyle;
      layer.color = textData.color;
      layer.backgroundColor = textData.backgroundColor;
      layer.textAlign = textData.textAlign;
      layer.stroke = textData.stroke;
      storyCanvas.addLayer(layer);
      selectLayer(layer.id);
    }
    onUpdate();
    setIsTextEditorOpen(false);
    setEditingTextLayerId(null);
  }, [storyCanvas, editingTextLayerId, selectLayer, onUpdate]);

  const handleTextEditorClose = useCallback(() => {
    setIsTextEditorOpen(false);
    setEditingTextLayerId(null);
  }, []);

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
