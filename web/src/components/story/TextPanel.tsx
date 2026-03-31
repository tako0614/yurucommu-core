/**
 * Text Panel for Story Editor
 *
 * Controls text layer properties: content, font, size, style, alignment,
 * color, background, stroke, and shadow.
 */

import { FONTS, TextLayer } from '../../lib/story-canvas.ts';
import { ColorPicker } from './ColorPicker.tsx';
import { TrashIcon, LayerUpIcon, LayerDownIcon } from './ToolPanelIcons.tsx';

interface TextPanelProps {
  layer: TextLayer;
  onUpdate: (updates: Partial<TextLayer>) => void;
  onDelete: () => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
}

export function TextPanel({
  layer,
  onUpdate,
  onDelete,
  onBringToFront,
  onSendToBack,
}: TextPanelProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-white font-medium">テキスト</h3>
        <div className="flex gap-1">
          <button
            onClick={onBringToFront}
            className="p-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg transition-colors"
            title="前面へ"
          >
            <LayerUpIcon />
          </button>
          <button
            onClick={onSendToBack}
            className="p-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg transition-colors"
            title="背面へ"
          >
            <LayerDownIcon />
          </button>
          <button
            onClick={onDelete}
            className="p-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg transition-colors"
          >
            <TrashIcon />
          </button>
        </div>
      </div>

      {/* Text content */}
      <div>
        <label className="text-neutral-400 text-sm">テキスト</label>
        <textarea
          value={layer.content}
          onChange={(e) => onUpdate({ content: e.target.value })}
          className="w-full mt-1 bg-neutral-800 text-white px-4 py-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          rows={3}
        />
      </div>

      {/* Font family */}
      <div>
        <label className="text-neutral-400 text-sm">フォント</label>
        <div className="grid grid-cols-2 gap-2 mt-1">
          {FONTS.map((font) => (
            <button
              key={font.id}
              onClick={() => onUpdate({ fontFamily: font.family })}
              className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                layer.fontFamily === font.family
                  ? 'bg-blue-500 text-white'
                  : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
              }`}
              style={{ fontFamily: font.family }}
            >
              {font.name}
            </button>
          ))}
        </div>
      </div>

      {/* Font size */}
      <div>
        <label className="text-neutral-400 text-sm">サイズ: {layer.fontSize}px</label>
        <input
          type="range"
          min="24"
          max="200"
          value={layer.fontSize}
          onChange={(e) => onUpdate({ fontSize: parseInt(e.target.value) })}
          className="w-full mt-1 accent-blue-500"
        />
      </div>

      {/* Font style */}
      <div className="flex gap-2">
        <button
          onClick={() => onUpdate({ fontWeight: layer.fontWeight === 'bold' ? 'normal' : 'bold' })}
          className={`flex-1 py-2 rounded-lg font-bold transition-colors ${
            layer.fontWeight === 'bold'
              ? 'bg-blue-500 text-white'
              : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
          }`}
        >
          B
        </button>
        <button
          onClick={() => onUpdate({ fontStyle: layer.fontStyle === 'italic' ? 'normal' : 'italic' })}
          className={`flex-1 py-2 rounded-lg italic transition-colors ${
            layer.fontStyle === 'italic'
              ? 'bg-blue-500 text-white'
              : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
          }`}
        >
          I
        </button>
      </div>

      {/* Text alignment */}
      <div>
        <label className="text-neutral-400 text-sm">配置</label>
        <div className="flex gap-2 mt-1">
          {(['left', 'center', 'right'] as const).map((align) => (
            <button
              key={align}
              onClick={() => onUpdate({ textAlign: align })}
              className={`flex-1 py-2 rounded-lg text-sm transition-colors ${
                layer.textAlign === align
                  ? 'bg-blue-500 text-white'
                  : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
              }`}
            >
              {align === 'left' ? '左' : align === 'center' ? '中央' : '右'}
            </button>
          ))}
        </div>
      </div>

      {/* Text color */}
      <ColorPicker
        label="文字色"
        color={layer.color}
        onChange={(color) => onUpdate({ color })}
      />

      {/* Background */}
      <div>
        <label className="text-neutral-400 text-sm">背景</label>
        <div className="flex gap-2 mt-1">
          <button
            onClick={() => onUpdate({ backgroundColor: undefined })}
            className={`flex-1 py-2 rounded-lg text-sm transition-colors ${
              !layer.backgroundColor
                ? 'bg-blue-500 text-white'
                : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
            }`}
          >
            なし
          </button>
          <button
            onClick={() => onUpdate({ backgroundColor: 'rgba(0,0,0,0.5)' })}
            className={`flex-1 py-2 rounded-lg text-sm transition-colors ${
              layer.backgroundColor
                ? 'bg-blue-500 text-white'
                : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
            }`}
          >
            あり
          </button>
        </div>
        {layer.backgroundColor && (
          <ColorPicker
            color={layer.backgroundColor}
            onChange={(color) => onUpdate({ backgroundColor: color })}
          />
        )}
      </div>

      {/* Stroke */}
      <div>
        <label className="text-neutral-400 text-sm">縁取り</label>
        <div className="flex gap-2 mt-1">
          <button
            onClick={() => onUpdate({ stroke: undefined })}
            className={`flex-1 py-2 rounded-lg text-sm transition-colors ${
              !layer.stroke
                ? 'bg-blue-500 text-white'
                : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
            }`}
          >
            なし
          </button>
          <button
            onClick={() => onUpdate({ stroke: { color: '#000000', width: 4 } })}
            className={`flex-1 py-2 rounded-lg text-sm transition-colors ${
              layer.stroke
                ? 'bg-blue-500 text-white'
                : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
            }`}
          >
            あり
          </button>
        </div>
        {layer.stroke && (
          <div className="mt-2 space-y-2">
            <ColorPicker
              color={layer.stroke.color}
              onChange={(color) => onUpdate({ stroke: { color, width: layer.stroke?.width ?? 4 } })}
            />
            <div>
              <label className="text-neutral-500 text-xs">太さ: {layer.stroke.width}px</label>
              <input
                type="range"
                min="1"
                max="20"
                value={layer.stroke.width}
                onChange={(e) => onUpdate({ stroke: { color: layer.stroke?.color ?? '#000000', width: parseInt(e.target.value) } })}
                className="w-full accent-blue-500"
              />
            </div>
          </div>
        )}
      </div>

      {/* Shadow */}
      <div>
        <label className="text-neutral-400 text-sm">影</label>
        <div className="flex gap-2 mt-1">
          <button
            onClick={() => onUpdate({ shadow: undefined })}
            className={`flex-1 py-2 rounded-lg text-sm transition-colors ${
              !layer.shadow
                ? 'bg-blue-500 text-white'
                : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
            }`}
          >
            なし
          </button>
          <button
            onClick={() => onUpdate({ shadow: { color: 'rgba(0,0,0,0.5)', blur: 10, offsetX: 2, offsetY: 2 } })}
            className={`flex-1 py-2 rounded-lg text-sm transition-colors ${
              layer.shadow
                ? 'bg-blue-500 text-white'
                : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
            }`}
          >
            あり
          </button>
        </div>
      </div>
    </div>
  );
}
