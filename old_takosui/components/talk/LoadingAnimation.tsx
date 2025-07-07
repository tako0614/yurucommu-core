import { createSignal, onCleanup, onMount } from "solid-js";

export default function LoadingAnimation() {
  const [dots, setDots] = createSignal(1);
  let interval: ReturnType<typeof setInterval>;

  onMount(() => {
    interval = setInterval(() => {
      setDots((prev) => (prev % 3) + 1);
    }, 500);
  });

  onCleanup(() => {
    clearInterval(interval);
  });

  return (
    <div class="flex flex-col items-center justify-center w-full h-screen">
      <div class="loading-spinner mb-4"></div>
      <div class="text-gradient font-medium text-lg">
        読み込み中{".".repeat(dots())}
      </div>
      <style>
        {`
        .loading-spinner {
          width: 50px;
          height: 50px;
          border: 3px solid rgba(0, 0, 0, 0.1);
          border-radius: 50%;
          border-top-color: #3b82f6;
          animation: spin 1s ease-in-out infinite;
        }
        
        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }
        
        .text-gradient {
          background-image: linear-gradient(to right, #3b82f6, #8b5cf6);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: pulse 2s infinite;
        }
        
        @keyframes pulse {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.7;
          }
        }
      `}
      </style>
    </div>
  );
}
