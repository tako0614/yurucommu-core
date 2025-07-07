import { atom, useAtom } from "solid-jotai";
import { createEffect, createSignal } from "solid-js";
import { getMessage } from "../../../utils/message/getMessage";
import { selectedRoomState } from "../../../utils/room/roomState";

// ビデオプレーヤーの状態管理用のatom
export const videoPlayerState = atom<{
  isOpen: boolean;
  videoUrl: string | null;
  videoType: string | null;
  filename?: string | null;
}>({
  isOpen: false,
  videoUrl: null,
  videoType: null,
  filename: null,
});

export const VideoPlayerComponent = ({
  content,
  senderName,
}: {
  content: {
    verified: boolean;
    encrypted: boolean;
    content: string;
    type: string;
    timestamp: string | number | Date;
    original?: string;
  };
  senderName: string;
}) => {
  const sellectedRoom = () => useAtom(selectedRoomState)[0];
  const [, setVideoPlayer] = useAtom(videoPlayerState);
  const [isLoading, setIsLoading] = createSignal(false);
  const [aspectRatio, setAspectRatio] = createSignal(0);
  const [loadingProgress, setLoadingProgress] = createSignal(0);

  const contentValue = JSON.parse(content.content);

  const onThumbnailLoad = (e: Event) => {
    const img = e.target as HTMLImageElement;
    setAspectRatio(img.naturalWidth / img.naturalHeight);
  };

  const handlePlayVideo = async () => {
    if (!content.original || !sellectedRoom()) {
      alert("オリジナルビデオが利用できません");
      return;
    }
    setIsLoading(true);
    setLoadingProgress(0);
    try {
      const originalVideo = await getMessage({
        messageid: content.original,
        //@ts-expect-error
        roomId: sellectedRoom()!.roomid,
        //@ts-expect-error
        type: sellectedRoom()!.type,
        senderId: senderName,
        isProgress: true,
        onProgress: (loaded, total) => {
          const progress = Math.round(100 * (loaded / total));
          console.log("ビデオ読み込み中:", progress, "%");
          setLoadingProgress(progress);
        },
      });
      const videoValue = JSON.parse(originalVideo.value.content);
      const videoDataURI =
        `data:${videoValue.metadata.mimeType};base64,${videoValue.uri}`;
      setVideoPlayer({
        isOpen: true,
        videoUrl: videoDataURI,
        videoType: videoValue.metadata.mimeType,
        filename: videoValue.metadata.filename,
      });
    } catch (error) {
      console.error("ビデオの読み込みに失敗しました", error);
      alert("ビデオの読み込みに失敗しました");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      class="media-container inline-block"
      style={{ "max-width": "100%", margin: "4px 0" }}
    >
      <div style={{ position: "relative", display: "inline-block" }}>
        <img
          src={`data:${contentValue.thumbnailMimeType};base64,${contentValue.thumbnailUri}`}
          alt="video thumbnail"
          class="rounded cursor-pointer"
          style={{
            width: aspectRatio() < 0.7 ? "auto" : "100%",
            height: aspectRatio() < 0.7 ? "220px" : "auto",
            "max-width": "300px",
            "max-height": "500px",
            "object-fit": "contain",
            "box-shadow": "0 4px 8px rgba(0, 0, 0, 0.5)",
            filter: isLoading() ? "brightness(0.7) blur(2px)" : "none",
            transition: "filter 0.3s ease",
          }}
          onLoad={onThumbnailLoad}
        />
        <button
          onClick={handlePlayVideo}
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            "font-size": "2rem",
            background: isLoading() ? "rgba(0,0,0,0.3)" : "rgba(0,0,0,0.5)",
            color: "white",
            border: "none",
            "border-radius": "50%",
            width: "60px",
            height: "60px",
            cursor: isLoading() ? "default" : "pointer",
            display: "flex",
            "align-items": "center",
            "justify-content": "center",
            transition: "all 0.3s ease",
            overflow: "hidden",
          }}
          disabled={isLoading()}
        >
          {isLoading()
            ? (
              <div
                class="loading-wrapper"
                style={{ position: "relative", width: "100%", height: "100%" }}
              >
                <div
                  class="loading-spinner"
                  style={{
                    position: "absolute",
                    top: "50%",
                    left: "50%",
                    transform: "translate(-50%, -50%)",
                    width: "30px",
                    height: "30px",
                    border: "3px solid rgba(255, 255, 255, 0.3)",
                    "border-top": "3px solid white",
                    "border-radius": "50%",
                    animation: "spin 1s linear infinite",
                  }}
                />
              </div>
            )
            : (
              <span
                style={{
                  "margin-left": "3px",
                  transform: "scale(1)",
                  transition: "transform 0.2s ease",
                }}
                class="hover:scale-110"
              >
                ▶
              </span>
            )}
        </button>

        {isLoading() && (
          <div
            class="loading-overlay"
            style={{
              position: "absolute",
              top: "0",
              left: "0",
              width: "100%",
              height: "100%",
              display: "flex",
              "flex-direction": "column",
              "justify-content": "center",
              "align-items": "center",
              "background-color": "rgba(0, 0, 0, 0.6)",
              "border-radius": "8px",
              "z-index": "10",
            }}
          >
            <div
              class="progress-container"
              style={{ width: "80%", margin: "8px 0", position: "relative" }}
            >
              <div
                class="progress-bar-bg"
                style={{
                  height: "4px",
                  width: "100%",
                  "background-color": "rgba(255, 255, 255, 0.3)",
                  "border-radius": "2px",
                }}
              >
                <div
                  class="progress-bar"
                  style={{
                    height: "100%",
                    width: `${loadingProgress()}%`,
                    "background-color": "#3b82f6",
                    "border-radius": "2px",
                    transition: "width 0.2s ease-out",
                  }}
                />
              </div>
              <div
                class="progress-text"
                style={{
                  "text-align": "center",
                  color: "white",
                  "font-size": "0.9rem",
                  margin: "8px 0 0",
                }}
              >
                {loadingProgress()}%
              </div>
            </div>
          </div>
        )}
      </div>
      {isLoading() && (
        <div
          class="loading-indicator"
          style={{
            "text-align": "center",
            "margin-top": "12px",
            "font-size": "0.9rem",
            "font-weight": "500",
            color: "#3b82f6",
            animation: "pulse 1.5s infinite",
          }}
        >
          ビデオ読み込み中...
        </div>
      )}

      <style>
        {`
        @keyframes spin {
          0% { transform: translate(-50%, -50%) rotate(0deg); }
          100% { transform: translate(-50%, -50%) rotate(360deg); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        .hover\\:scale-110:hover {
          transform: scale(1.1);
        }
      `}
      </style>
    </div>
  );
};

export const DirectVideoPlayer = ({
  videoUrl,
  videoType,
  filename,
}: {
  videoUrl: string;
  videoType: string;
  filename: string;
}) => {
  const [, setVideoPlayer] = useAtom(videoPlayerState);
  const [aspectRatio, setAspectRatio] = createSignal(0);

  const onVideoMetadataLoaded = (e: Event) => {
    const video = e.target as HTMLVideoElement;
    setAspectRatio(video.videoWidth / video.videoHeight);
  };

  const handlePlayVideo = () => {
    setVideoPlayer({
      isOpen: true,
      videoUrl,
      videoType,
      filename,
    });
  };

  return (
    <div
      class="media-container inline-block"
      style={{ "max-width": "100%", margin: "4px 0" }}
    >
      <div
        style={{
          position: "relative",
          display: "inline-block",
          "border-radius": "8px",
          overflow: "hidden",
        }}
      >
        <video
          class="video-preview"
          style={{
            width: aspectRatio() < 0.7 ? "auto" : "100%",
            height: aspectRatio() < 0.7 ? "220px" : "auto",
            "max-width": "300px",
            "max-height": "500px",
            "object-fit": "contain",
          }}
          onClick={handlePlayVideo}
          onLoadedMetadata={onVideoMetadataLoaded}
        >
          <source src={videoUrl} type={videoType} />
          お使いのブラウザはこの動画をサポートしていません。
        </video>
        <button
          onClick={handlePlayVideo}
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            background: "rgba(0,0,0,0.5)",
            color: "white",
            border: "none",
            "border-radius": "50%",
            width: "50px",
            height: "50px",
            cursor: "pointer",
            display: "flex",
            "align-items": "center",
            "justify-content": "center",
          }}
        >
          <span style={{ "margin-left": "3px" }}>▶</span>
        </button>
      </div>
      <div
        style={{
          padding: "8px",
          "font-size": "0.9rem",
          display: "flex",
          "justify-content": "space-between",
          "align-items": "center",
          "max-width": "300px",
        }}
      >
        <div
          style={{
            overflow: "hidden",
            "text-overflow": "ellipsis",
            "white-space": "nowrap",
            "max-width": "170px",
          }}
        >
          {filename}
        </div>
        <button
          onClick={handlePlayVideo}
          style={{
            background: "#3b82f6",
            color: "white",
            border: "none",
            padding: "4px 8px",
            "border-radius": "4px",
            "font-size": "0.8rem",
            cursor: "pointer",
          }}
        >
          再生
        </button>
      </div>
    </div>
  );
};

export function VideoPlayer() {
  const [videoPlayer, setVideoPlayer] = useAtom(videoPlayerState);
  const closePlayer = () => {
    setVideoPlayer({
      isOpen: false,
      videoUrl: null,
      videoType: null,
      filename: null,
    });
  };

  const handleDownload = (e: Event) => {
    e.stopPropagation();
    if (!videoPlayer().videoUrl) return;

    const link = document.createElement("a");
    link.href = videoPlayer().videoUrl!;

    // ファイル名設定（filenameがなければ日時を使用）
    const filename = videoPlayer().filename ||
      `video_${new Date().toISOString().replace(/[:.]/g, "-")}`;

    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <>
      {videoPlayer().isOpen && (
        <div
          class="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50"
          onClick={closePlayer}
        >
          <div
            class="relative max-w-[90%] max-h-[90%] bg-black p-2 rounded-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <video controls autoplay class="max-w-full max-h-[80vh]">
              <source
                src={videoPlayer().videoUrl!}
                type={videoPlayer().videoType!}
              />
              お使いのブラウザはビデオタグをサポートしていません。
            </video>
            <button
              class="absolute top-2 right-2 bg-white bg-opacity-70 rounded-full p-2 text-black hover:bg-opacity-100"
              onClick={closePlayer}
            >
              ✕
            </button>
            <button
              class="absolute bottom-2 right-2 bg-white bg-opacity-70 rounded-md px-3 py-1 text-black hover:bg-opacity-100 text-sm flex items-center"
              onClick={handleDownload}
            >
              <svg
                class="w-4 h-4 mr-1"
                fill="currentColor"
                viewBox="0 0 20 20"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path d="M10 12l-5-5 1.41-1.41L10 9.17l3.59-3.58L15 7l-5 5z" />
                <path d="M10 12v6H8v-6H3l7-7 7 7h-5z" fill="none" />
              </svg>
              保存
            </button>
          </div>
        </div>
      )}
    </>
  );
}
