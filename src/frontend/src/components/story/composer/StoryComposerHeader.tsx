import type { ReactNode } from 'react';

type Tool = 'text' | 'sticker' | 'music' | 'effect' | 'resize';

interface StoryComposerHeaderProps {
  onClose: () => void;
  activeTool: Tool | null;
  onToolClick: (tool: Tool) => void;
}

interface ToolButtonProps {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
}

// Instagram-style right side tool button (label left, icon right, right-aligned)
const ToolButton = ({ icon, label, onClick, active = false }: ToolButtonProps) => (
  <button
    onClick={onClick}
    className="flex items-center justify-end gap-3 w-full"
  >
    <span className="text-white text-sm font-medium drop-shadow-md">{label}</span>
    <span className={`w-11 h-11 flex items-center justify-center rounded-full ${active ? 'bg-white/30' : 'bg-neutral-800/80'}`}>
      {icon}
    </span>
  </button>
);

const BackIcon = () => (
  <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
  </svg>
);

const EffectIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
  </svg>
);

const ResizeIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5" />
  </svg>
);

const MusicIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
  </svg>
);

const ChevronDownIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
  </svg>
);

const StickerIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

export function StoryComposerHeader({ onClose, activeTool, onToolClick }: StoryComposerHeaderProps) {
  return (
    <>
      <button
        onClick={onClose}
        className="absolute z-10 p-2 bg-black/40 hover:bg-black/60 rounded-full text-white transition-colors"
        style={{ top: 'calc(env(safe-area-inset-top, 16px) + 16px)', left: '16px' }}
      >
        <BackIcon />
      </button>

      <div
        className="absolute right-4 z-10 flex flex-col gap-4 w-36"
        style={{ top: 'calc(env(safe-area-inset-top, 16px) + 16px)' }}
      >
        <ToolButton
          icon={<span className="text-lg font-bold text-white">Aa</span>}
          label="テキスト"
          onClick={() => onToolClick('text')}
          active={activeTool === 'text'}
        />
        <ToolButton
          icon={<StickerIcon />}
          label="スタンプ"
          onClick={() => onToolClick('sticker')}
          active={activeTool === 'sticker'}
        />
        <ToolButton
          icon={<MusicIcon />}
          label="音楽"
          onClick={() => onToolClick('music')}
          active={activeTool === 'music'}
        />
        <ToolButton
          icon={<EffectIcon />}
          label="エフェクト"
          onClick={() => onToolClick('effect')}
          active={activeTool === 'effect'}
        />
        <ToolButton
          icon={<ResizeIcon />}
          label="サイズ変更"
          onClick={() => onToolClick('resize')}
          active={activeTool === 'resize'}
        />
        <button className="flex items-center justify-end w-full">
          <span className="p-2 rounded-full bg-black/40">
            <ChevronDownIcon />
          </span>
        </button>
      </div>
    </>
  );
}
