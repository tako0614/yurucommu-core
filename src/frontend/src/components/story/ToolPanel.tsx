/**
 * Tool Panel Components for Story Editor
 *
 * Various tool panels that appear in the right sidebar.
 */

import { FONTS, FILTER_PRESETS, ImageFilter, TextLayer, MediaLayer } from '../../lib/storyCanvas';
import { ColorPicker, GradientPicker } from './ColorPicker';
import { EmojiPicker } from './EmojiPicker';

// Icons
const TrashIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
  </svg>
);

const LayerUpIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
  </svg>
);

const LayerDownIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
  </svg>
);

// ===============================================
// Background Panel
// ===============================================
interface BackgroundPanelProps {
  fillType: 'solid' | 'gradient';
  solidColor: string;
  gradientColors: string[];
  gradientAngle: number;
  onSolidColorChange: (color: string) => void;
  onGradientChange: (colors: string[], angle: number) => void;
  onFillTypeChange: (type: 'solid' | 'gradient') => void;
}

export function BackgroundPanel({
  fillType,
  solidColor,
  gradientColors,
  gradientAngle,
  onSolidColorChange,
  onGradientChange,
  onFillTypeChange,
}: BackgroundPanelProps) {
  return (
    <div className="space-y-4">
      <h3 className="text-white font-medium">背景</h3>

      {/* Fill type toggle */}
      <div className="flex gap-2">
        <button
          onClick={() => onFillTypeChange('solid')}
          className={`flex-1 py-2 rounded-lg text-sm transition-colors ${
            fillType === 'solid'
              ? 'bg-blue-500 text-white'
              : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'
          }`}
        >
          単色
        </button>
        <button
          onClick={() => onFillTypeChange('gradient')}
          className={`flex-1 py-2 rounded-lg text-sm transition-colors ${
            fillType === 'gradient'
              ? 'bg-blue-500 text-white'
              : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'
          }`}
        >
          グラデーション
        </button>
      </div>

      {/* Color picker based on fill type */}
      {fillType === 'solid' ? (
        <ColorPicker color={solidColor} onChange={onSolidColorChange} />
      ) : (
        <GradientPicker
          colors={gradientColors}
          angle={gradientAngle}
          onChange={onGradientChange}
        />
      )}
    </div>
  );
}

// ===============================================
// Text Panel
// ===============================================
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
              onChange={(color) => onUpdate({ stroke: { ...layer.stroke!, color } })}
            />
            <div>
              <label className="text-neutral-500 text-xs">太さ: {layer.stroke.width}px</label>
              <input
                type="range"
                min="1"
                max="20"
                value={layer.stroke.width}
                onChange={(e) => onUpdate({ stroke: { ...layer.stroke!, width: parseInt(e.target.value) } })}
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

// ===============================================
// Media Panel (Image)
// ===============================================
interface MediaPanelProps {
  layer: MediaLayer;
  onUpdate: (updates: Partial<MediaLayer>) => void;
  onDelete: () => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
}

export function MediaPanel({
  layer,
  onUpdate,
  onDelete,
  onBringToFront,
  onSendToBack,
}: MediaPanelProps) {
  const currentFilter = layer.filter || FILTER_PRESETS[0].filter;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-white font-medium">画像</h3>
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

      {/* Filter presets */}
      <div>
        <label className="text-neutral-400 text-sm">フィルター</label>
        <div className="grid grid-cols-4 gap-2 mt-2">
          {FILTER_PRESETS.map((preset) => (
            <button
              key={preset.id}
              onClick={() => onUpdate({ filter: preset.filter })}
              className={`p-2 rounded-lg text-xs transition-colors ${
                JSON.stringify(currentFilter) === JSON.stringify(preset.filter)
                  ? 'bg-blue-500 text-white'
                  : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
              }`}
            >
              {preset.name}
            </button>
          ))}
        </div>
      </div>

      {/* Manual adjustments */}
      <div className="space-y-3">
        <div>
          <label className="text-neutral-500 text-xs">明るさ: {currentFilter.brightness}%</label>
          <input
            type="range"
            min="0"
            max="200"
            value={currentFilter.brightness}
            onChange={(e) => onUpdate({ filter: { ...currentFilter, brightness: parseInt(e.target.value) } })}
            className="w-full accent-blue-500"
          />
        </div>
        <div>
          <label className="text-neutral-500 text-xs">コントラスト: {currentFilter.contrast}%</label>
          <input
            type="range"
            min="0"
            max="200"
            value={currentFilter.contrast}
            onChange={(e) => onUpdate({ filter: { ...currentFilter, contrast: parseInt(e.target.value) } })}
            className="w-full accent-blue-500"
          />
        </div>
        <div>
          <label className="text-neutral-500 text-xs">彩度: {currentFilter.saturation}%</label>
          <input
            type="range"
            min="0"
            max="200"
            value={currentFilter.saturation}
            onChange={(e) => onUpdate({ filter: { ...currentFilter, saturation: parseInt(e.target.value) } })}
            className="w-full accent-blue-500"
          />
        </div>
      </div>

      {/* Opacity */}
      <div>
        <label className="text-neutral-500 text-xs">不透明度: {Math.round(layer.opacity * 100)}%</label>
        <input
          type="range"
          min="0"
          max="100"
          value={layer.opacity * 100}
          onChange={(e) => onUpdate({ opacity: parseInt(e.target.value) / 100 })}
          className="w-full accent-blue-500"
        />
      </div>
    </div>
  );
}

// ===============================================
// Sticker Panel
// ===============================================
interface StickerPanelProps {
  onAddEmoji: (emoji: string) => void;
}

export function StickerPanel({ onAddEmoji }: StickerPanelProps) {
  return (
    <div className="space-y-4">
      <h3 className="text-white font-medium">スタンプ</h3>
      <EmojiPicker onSelect={onAddEmoji} />
    </div>
  );
}

// ===============================================
// Drawing Panel
// ===============================================
interface DrawingPanelProps {
  color: string;
  width: number;
  opacity: number;
  onColorChange: (color: string) => void;
  onWidthChange: (width: number) => void;
  onOpacityChange: (opacity: number) => void;
  onClear: () => void;
  onUndo: () => void;
}

export function DrawingPanel({
  color,
  width,
  opacity,
  onColorChange,
  onWidthChange,
  onOpacityChange,
  onClear,
  onUndo,
}: DrawingPanelProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-white font-medium">描画</h3>
        <div className="flex gap-2">
          <button
            onClick={onUndo}
            className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-sm transition-colors"
          >
            戻す
          </button>
          <button
            onClick={onClear}
            className="px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg text-sm transition-colors"
          >
            クリア
          </button>
        </div>
      </div>

      {/* Color */}
      <ColorPicker label="色" color={color} onChange={onColorChange} />

      {/* Width */}
      <div>
        <label className="text-neutral-400 text-sm">太さ: {width}px</label>
        <input
          type="range"
          min="2"
          max="50"
          value={width}
          onChange={(e) => onWidthChange(parseInt(e.target.value))}
          className="w-full mt-1 accent-blue-500"
        />
        {/* Width preview */}
        <div className="flex items-center justify-center h-12 mt-2 bg-neutral-800 rounded-lg">
          <div
            className="rounded-full"
            style={{
              width: width,
              height: width,
              backgroundColor: color,
              opacity: opacity,
            }}
          />
        </div>
      </div>

      {/* Opacity */}
      <div>
        <label className="text-neutral-400 text-sm">不透明度: {Math.round(opacity * 100)}%</label>
        <input
          type="range"
          min="10"
          max="100"
          value={opacity * 100}
          onChange={(e) => onOpacityChange(parseInt(e.target.value) / 100)}
          className="w-full mt-1 accent-blue-500"
        />
      </div>
    </div>
  );
}
