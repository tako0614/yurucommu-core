/**
 * Instagram-style Text Editor Modal
 *
 * Full-screen text editing experience with:
 * - Direct text input in center
 * - Font, color, alignment controls at bottom
 * - Background style presets (none, semi-transparent, solid)
 * - Real-time preview
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { FONTS } from '../../lib/storyCanvas';

// Text style presets (Instagram-like A, A, A buttons)
const TEXT_STYLES = [
  { id: 'none', label: 'A', bg: 'transparent', description: 'なし' },
  { id: 'semi', label: 'A', bg: 'rgba(0,0,0,0.5)', description: '半透明' },
  { id: 'solid', label: 'A', bg: '#000000', description: '塗り' },
] as const;

// Color palette
const COLORS = [
  '#FFFFFF', '#000000', '#FF3B30', '#FF9500', '#FFCC00',
  '#34C759', '#007AFF', '#5856D6', '#AF52DE', '#FF2D55',
];

// Alignment options
const ALIGNMENTS = [
  { id: 'left', icon: '≡' },
  { id: 'center', icon: '≡' },
  { id: 'right', icon: '≡' },
] as const;

interface TextEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (text: TextData) => void;
  initialText?: TextData;
}

export interface TextData {
  content: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: 'normal' | 'bold';
  fontStyle: 'normal' | 'italic';
  color: string;
  backgroundColor?: string;
  textAlign: 'left' | 'center' | 'right';
  stroke?: { color: string; width: number };
}

const defaultTextData: TextData = {
  content: '',
  fontFamily: FONTS[0]?.family || 'sans-serif',
  fontSize: 64,
  fontWeight: 'bold',
  fontStyle: 'normal',
  color: '#FFFFFF',
  backgroundColor: undefined,
  textAlign: 'center',
  stroke: { color: '#000000', width: 3 },
};

export function TextEditorModal({
  isOpen,
  onClose,
  onSave,
  initialText,
}: TextEditorModalProps) {
  const [text, setText] = useState<TextData>(initialText || defaultTextData);
  const [showFontPicker, setShowFontPicker] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      const timeoutId = setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
      return () => clearTimeout(timeoutId);
    }
  }, [isOpen]);

  // Reset state when initialText changes
  useEffect(() => {
    if (isOpen) {
      setText(initialText || defaultTextData);
    }
  }, [isOpen, initialText]);

  const handleSave = useCallback(() => {
    if (text.content.trim()) {
      onSave(text);
    }
    onClose();
  }, [text, onSave, onClose]);

  const handleStyleChange = (styleId: string) => {
    const style = TEXT_STYLES.find(s => s.id === styleId);
    if (style) {
      setText(prev => ({
        ...prev,
        backgroundColor: style.bg === 'transparent' ? undefined : style.bg,
      }));
    }
  };

  const getCurrentStyle = () => {
    if (!text.backgroundColor) return 'none';
    if (text.backgroundColor.includes('rgba')) return 'semi';
    return 'solid';
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] bg-black/90 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <button
          onClick={onClose}
          className="text-white text-lg font-medium"
        >
          キャンセル
        </button>
        <div className="flex gap-2">
          {/* Font picker toggle */}
          <button
            onClick={() => {
              setShowFontPicker(!showFontPicker);
              setShowColorPicker(false);
            }}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              showFontPicker ? 'bg-white text-black' : 'bg-white/20 text-white'
            }`}
          >
            Aa
          </button>
          {/* Color picker toggle */}
          <button
            onClick={() => {
              setShowColorPicker(!showColorPicker);
              setShowFontPicker(false);
            }}
            className="w-8 h-8 rounded-full border-2 border-white"
            style={{ backgroundColor: text.color }}
          />
        </div>
        <button
          onClick={handleSave}
          className="text-blue-400 text-lg font-semibold"
        >
          完了
        </button>
      </div>

      {/* Font picker dropdown */}
      {showFontPicker && (
        <div className="px-4 py-2 bg-black/50">
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
            {FONTS.map((font) => (
              <button
                key={font.id}
                onClick={() => setText(prev => ({ ...prev, fontFamily: font.family }))}
                className={`px-4 py-2 rounded-full whitespace-nowrap text-sm transition-colors ${
                  text.fontFamily === font.family
                    ? 'bg-white text-black'
                    : 'bg-white/20 text-white'
                }`}
                style={{ fontFamily: font.family }}
              >
                {font.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Color picker dropdown */}
      {showColorPicker && (
        <div className="px-4 py-3 bg-black/50">
          <div className="flex gap-2 justify-center">
            {COLORS.map((color) => (
              <button
                key={color}
                onClick={() => setText(prev => ({ ...prev, color }))}
                className={`w-8 h-8 rounded-full transition-transform ${
                  text.color === color ? 'scale-125 ring-2 ring-white ring-offset-2 ring-offset-black' : ''
                }`}
                style={{ backgroundColor: color }}
              />
            ))}
            {/* Custom color input */}
            <label className="w-8 h-8 rounded-full bg-gradient-to-br from-red-500 via-green-500 to-blue-500 cursor-pointer flex items-center justify-center">
              <input
                type="color"
                value={text.color}
                onChange={(e) => setText(prev => ({ ...prev, color: e.target.value }))}
                className="opacity-0 absolute w-0 h-0"
              />
              <span className="text-white text-xs">+</span>
            </label>
          </div>
        </div>
      )}

      {/* Main text input area */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div
          className="w-full max-w-md"
          style={{
            backgroundColor: text.backgroundColor,
            padding: text.backgroundColor ? '16px 24px' : '0',
            borderRadius: text.backgroundColor ? '12px' : '0',
          }}
        >
          <textarea
            ref={inputRef}
            value={text.content}
            onChange={(e) => setText(prev => ({ ...prev, content: e.target.value }))}
            placeholder="テキストを入力"
            className="w-full bg-transparent border-none outline-none resize-none text-center"
            style={{
              fontFamily: text.fontFamily,
              fontSize: `${Math.min(text.fontSize, 48)}px`,
              fontWeight: text.fontWeight,
              fontStyle: text.fontStyle,
              color: text.color,
              textAlign: text.textAlign,
              textShadow: text.stroke
                ? `
                  -${text.stroke.width}px -${text.stroke.width}px 0 ${text.stroke.color},
                  ${text.stroke.width}px -${text.stroke.width}px 0 ${text.stroke.color},
                  -${text.stroke.width}px ${text.stroke.width}px 0 ${text.stroke.color},
                  ${text.stroke.width}px ${text.stroke.width}px 0 ${text.stroke.color}
                `
                : 'none',
              lineHeight: 1.4,
              minHeight: '100px',
            }}
            rows={3}
          />
        </div>
      </div>

      {/* Bottom toolbar */}
      <div className="px-4 py-4 bg-black/50 space-y-4">
        {/* Text style buttons (A, A, A) */}
        <div className="flex justify-center gap-4">
          {TEXT_STYLES.map((style) => (
            <button
              key={style.id}
              onClick={() => handleStyleChange(style.id)}
              className={`w-10 h-10 rounded-lg flex items-center justify-center font-bold text-lg transition-all ${
                getCurrentStyle() === style.id
                  ? 'ring-2 ring-white scale-110'
                  : ''
              }`}
              style={{
                backgroundColor: style.id === 'none' ? 'transparent' : style.bg,
                color: style.id === 'none' ? '#fff' : (style.id === 'solid' ? '#fff' : '#fff'),
                border: style.id === 'none' ? '2px solid rgba(255,255,255,0.5)' : 'none',
              }}
            >
              A
            </button>
          ))}
        </div>

        {/* Alignment */}
        <div className="flex justify-center gap-2">
          {(['left', 'center', 'right'] as const).map((align) => (
            <button
              key={align}
              onClick={() => setText(prev => ({ ...prev, textAlign: align }))}
              className={`w-12 h-10 rounded-lg flex items-center justify-center transition-colors ${
                text.textAlign === align
                  ? 'bg-white text-black'
                  : 'bg-white/20 text-white'
              }`}
            >
              {align === 'left' && (
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M2 4.75A.75.75 0 012.75 4h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 4.75zm0 5A.75.75 0 012.75 9h9.5a.75.75 0 010 1.5h-9.5A.75.75 0 012 9.75zm0 5a.75.75 0 01.75-.75h14.5a.75.75 0 010 1.5H2.75a.75.75 0 01-.75-.75z" clipRule="evenodd" />
                </svg>
              )}
              {align === 'center' && (
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M2 4.75A.75.75 0 012.75 4h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 4.75zm2.5 5a.75.75 0 01.75-.75h9.5a.75.75 0 010 1.5h-9.5a.75.75 0 01-.75-.75zm-2.5 5a.75.75 0 01.75-.75h14.5a.75.75 0 010 1.5H2.75a.75.75 0 01-.75-.75z" clipRule="evenodd" />
                </svg>
              )}
              {align === 'right' && (
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M2 4.75A.75.75 0 012.75 4h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 4.75zm5 5a.75.75 0 01.75-.75h9.5a.75.75 0 010 1.5h-9.5A.75.75 0 017 9.75zm-5 5a.75.75 0 01.75-.75h14.5a.75.75 0 010 1.5H2.75a.75.75 0 01-.75-.75z" clipRule="evenodd" />
                </svg>
              )}
            </button>
          ))}
        </div>

        {/* Font size slider */}
        <div className="flex items-center gap-3 px-2">
          <span className="text-white/60 text-xs">A</span>
          <input
            type="range"
            min="24"
            max="120"
            value={text.fontSize}
            onChange={(e) => setText(prev => ({ ...prev, fontSize: parseInt(e.target.value) }))}
            className="flex-1 accent-white h-1"
          />
          <span className="text-white text-sm">A</span>
        </div>

        {/* Bold / Italic toggle */}
        <div className="flex justify-center gap-2">
          <button
            onClick={() => setText(prev => ({
              ...prev,
              fontWeight: prev.fontWeight === 'bold' ? 'normal' : 'bold'
            }))}
            className={`w-12 h-10 rounded-lg flex items-center justify-center font-bold transition-colors ${
              text.fontWeight === 'bold'
                ? 'bg-white text-black'
                : 'bg-white/20 text-white'
            }`}
          >
            B
          </button>
          <button
            onClick={() => setText(prev => ({
              ...prev,
              fontStyle: prev.fontStyle === 'italic' ? 'normal' : 'italic'
            }))}
            className={`w-12 h-10 rounded-lg flex items-center justify-center italic transition-colors ${
              text.fontStyle === 'italic'
                ? 'bg-white text-black'
                : 'bg-white/20 text-white'
            }`}
          >
            I
          </button>
          <button
            onClick={() => setText(prev => ({
              ...prev,
              stroke: prev.stroke ? undefined : { color: '#000000', width: 3 }
            }))}
            className={`w-12 h-10 rounded-lg flex items-center justify-center font-bold transition-colors ${
              text.stroke
                ? 'bg-white text-black'
                : 'bg-white/20 text-white'
            }`}
            style={{
              textShadow: '1px 1px 0 #666, -1px -1px 0 #666, 1px -1px 0 #666, -1px 1px 0 #666',
            }}
          >
            A
          </button>
        </div>
      </div>
    </div>
  );
}

export default TextEditorModal;
