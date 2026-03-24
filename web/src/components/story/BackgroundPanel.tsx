/**
 * Background Panel for Story Editor
 *
 * Controls background fill type (solid or gradient) and color selection.
 */

import { ColorPicker, GradientPicker } from './ColorPicker';

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
