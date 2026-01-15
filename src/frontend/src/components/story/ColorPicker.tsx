/**
 * Color Picker Component
 *
 * Simple color picker with presets and custom color input.
 */

import { useState } from 'react';

interface ColorPickerProps {
  color: string;
  onChange: (color: string) => void;
  label?: string;
  showAlpha?: boolean;
}

// Color presets
const PRESET_COLORS = [
  '#ffffff', '#000000', '#ff0000', '#ff6b6b',
  '#ff9500', '#ffcc00', '#4cd964', '#34c759',
  '#5ac8fa', '#007aff', '#5856d6', '#af52de',
  '#ff2d55', '#ff375f', '#8e8e93', '#636366',
];

const GRADIENT_PRESETS = [
  { colors: ['#667eea', '#764ba2'], angle: 135 },
  { colors: ['#fa709a', '#fee140'], angle: 135 },
  { colors: ['#667eea', '#00d4ff'], angle: 135 },
  { colors: ['#11998e', '#38ef7d'], angle: 135 },
  { colors: ['#0f0c29', '#302b63', '#24243e'], angle: 135 },
  { colors: ['#f093fb', '#f5576c'], angle: 135 },
  { colors: ['#4facfe', '#00f2fe'], angle: 135 },
  { colors: ['#43e97b', '#38f9d7'], angle: 135 },
];

export function ColorPicker({ color, onChange, label, showAlpha = false }: ColorPickerProps) {
  const [showCustom, setShowCustom] = useState(false);
  const [customColor, setCustomColor] = useState(color);

  const handlePresetClick = (preset: string) => {
    onChange(preset);
    setCustomColor(preset);
  };

  const handleCustomChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setCustomColor(value);
    onChange(value);
  };

  return (
    <div className="space-y-2">
      {label && (
        <label className="text-neutral-400 text-sm">{label}</label>
      )}

      {/* Preset colors */}
      <div className="grid grid-cols-8 gap-1">
        {PRESET_COLORS.map((preset) => (
          <button
            key={preset}
            onClick={() => handlePresetClick(preset)}
            className={`w-8 h-8 rounded-lg border-2 transition-all ${
              color === preset
                ? 'border-white scale-110 shadow-lg'
                : 'border-transparent hover:scale-105'
            }`}
            style={{ backgroundColor: preset }}
          />
        ))}
      </div>

      {/* Custom color toggle */}
      <button
        onClick={() => setShowCustom(!showCustom)}
        className="text-neutral-400 text-xs hover:text-white transition-colors"
      >
        カスタムカラー {showCustom ? '▲' : '▼'}
      </button>

      {/* Custom color input */}
      {showCustom && (
        <div className="flex gap-2 items-center">
          <input
            type="color"
            value={customColor.startsWith('#') ? customColor : '#ffffff'}
            onChange={handleCustomChange}
            className="w-10 h-10 rounded-lg cursor-pointer bg-transparent"
          />
          <input
            type="text"
            value={customColor}
            onChange={handleCustomChange}
            placeholder="#ffffff"
            className="flex-1 bg-neutral-800 text-white px-3 py-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      )}
    </div>
  );
}

// Gradient picker variant
interface GradientPickerProps {
  colors: string[];
  angle: number;
  onChange: (colors: string[], angle: number) => void;
  label?: string;
}

export function GradientPicker({ colors, angle, onChange, label }: GradientPickerProps) {
  const getGradientStyle = (c: string[], a: number) => {
    return `linear-gradient(${a}deg, ${c.join(', ')})`;
  };

  return (
    <div className="space-y-2">
      {label && (
        <label className="text-neutral-400 text-sm">{label}</label>
      )}

      {/* Preset gradients */}
      <div className="grid grid-cols-4 gap-2">
        {GRADIENT_PRESETS.map((preset, i) => (
          <button
            key={i}
            onClick={() => onChange(preset.colors, preset.angle)}
            className={`w-full aspect-square rounded-lg border-2 transition-all ${
              JSON.stringify(colors) === JSON.stringify(preset.colors)
                ? 'border-white scale-105 shadow-lg'
                : 'border-transparent hover:scale-105'
            }`}
            style={{ background: getGradientStyle(preset.colors, preset.angle) }}
          />
        ))}
      </div>

      {/* Custom gradient controls */}
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="text-neutral-500 text-xs">開始色</label>
          <input
            type="color"
            value={colors[0] || '#667eea'}
            onChange={(e) => onChange([e.target.value, colors[1] || '#764ba2'], angle)}
            className="w-full h-8 rounded cursor-pointer bg-transparent"
          />
        </div>
        <div className="flex-1">
          <label className="text-neutral-500 text-xs">終了色</label>
          <input
            type="color"
            value={colors[colors.length - 1] || '#764ba2'}
            onChange={(e) => onChange([colors[0] || '#667eea', e.target.value], angle)}
            className="w-full h-8 rounded cursor-pointer bg-transparent"
          />
        </div>
      </div>

      {/* Angle slider */}
      <div>
        <label className="text-neutral-500 text-xs">角度: {angle}°</label>
        <input
          type="range"
          min="0"
          max="360"
          value={angle}
          onChange={(e) => onChange(colors, parseInt(e.target.value))}
          className="w-full accent-blue-500"
        />
      </div>
    </div>
  );
}

export default ColorPicker;
