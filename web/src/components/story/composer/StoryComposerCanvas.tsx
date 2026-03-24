import type { MouseEvent, PointerEvent, RefObject, TouchEvent, WheelEvent } from 'react';

interface StoryComposerCanvasProps {
  canvasContainerRef: RefObject<HTMLDivElement>;
  displayCanvasRef: RefObject<HTMLCanvasElement>;
  displayDimensions: { width: number; height: number };
  videoPreview: string | null;
  videoRef: RefObject<HTMLVideoElement>;
  videoPosition: { x: number; y: number };
  videoScale: number;
  videoRotation: number;
  onCanvasPointerDown: (e: MouseEvent | TouchEvent) => void;
  onCanvasWheel: (e: WheelEvent<HTMLDivElement>) => void;
  onVideoPointerDown: (e: PointerEvent<HTMLDivElement>) => void;
  onVideoPointerMove: (e: PointerEvent<HTMLDivElement>) => void;
  onVideoPointerUp: (e: PointerEvent<HTMLDivElement>) => void;
  onVideoWheel: (e: WheelEvent<HTMLDivElement>) => void;
  onVideoTouchStart: (e: TouchEvent<HTMLDivElement>) => void;
  onVideoTouchMove: (e: TouchEvent<HTMLDivElement>) => void;
  onVideoTouchEnd: (e: TouchEvent<HTMLDivElement>) => void;
}

export function StoryComposerCanvas({
  canvasContainerRef,
  displayCanvasRef,
  displayDimensions,
  videoPreview,
  videoRef,
  videoPosition,
  videoScale,
  videoRotation,
  onCanvasPointerDown,
  onCanvasWheel,
  onVideoPointerDown,
  onVideoPointerMove,
  onVideoPointerUp,
  onVideoWheel,
  onVideoTouchStart,
  onVideoTouchMove,
  onVideoTouchEnd,
}: StoryComposerCanvasProps) {
  return (
    <div
      ref={canvasContainerRef}
      className="absolute inset-0 flex items-center justify-center"
      onMouseDown={videoPreview ? undefined : onCanvasPointerDown}
      onTouchStart={videoPreview ? undefined : onCanvasPointerDown}
      onWheel={videoPreview ? undefined : onCanvasWheel}
    >
      {videoPreview && (
        <div
          className="absolute inset-0 overflow-hidden touch-none z-10"
          onPointerDown={onVideoPointerDown}
          onPointerMove={onVideoPointerMove}
          onPointerUp={onVideoPointerUp}
          onPointerCancel={onVideoPointerUp}
          onWheel={onVideoWheel}
          onTouchStart={onVideoTouchStart}
          onTouchMove={onVideoTouchMove}
          onTouchEnd={onVideoTouchEnd}
        >
          <video
            ref={videoRef}
            src={videoPreview}
            className="absolute w-full h-full object-cover origin-center"
            style={{
              transform: `translate(${videoPosition.x}px, ${videoPosition.y}px) scale(${videoScale}) rotate(${videoRotation}deg)`,
            }}
            autoPlay
            loop
            muted
            playsInline
          />
          {videoScale === 1 && videoPosition.x === 0 && videoPosition.y === 0 && videoRotation === 0 && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1.5 bg-black/70 rounded-full pointer-events-none">
              <span className="text-white/80 text-xs">2本指で拡大縮小・回転・ドラッグで移動</span>
            </div>
          )}
        </div>
      )}

      <canvas
        ref={displayCanvasRef}
        width={displayDimensions.width}
        height={displayDimensions.height}
        className={`w-full h-full object-contain ${videoPreview ? 'absolute inset-0' : ''}`}
        style={videoPreview ? { mixBlendMode: 'normal', pointerEvents: 'none' } : undefined}
      />
    </div>
  );
}
