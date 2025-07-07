import { atom, useAtom, useAtomValue } from "solid-jotai";
import { createSignal } from "solid-js";
import { getMessage } from "../../../utils/message/getMessage";
import { selectedRoomState } from "../../../utils/room/roomState";

// 画像拡大表示用の状態管理
export const zoomedImageState = atom<{
  isOpen: boolean;
  original?: string | null;
  imageUrl: string | null;
  senderId: string | null;
  filename?: string | null;
}>({
  isOpen: false,
  senderId: null,
  original: null,
  imageUrl: null,
  filename: null,
});

export function ImageViewer() {
  const [zoomedImage, setZoomedImage] = useAtom(zoomedImageState);
  const [isShowingOriginal, setIsShowingOriginal] = createSignal(false);
  const [isLoading, setIsLoading] = createSignal(false);
  const sellectedRoom = useAtomValue(selectedRoomState);

  const closeViewer = () => {
    setZoomedImage({
      isOpen: false,
      original: null,
      imageUrl: null,
      senderId: null,
      filename: null,
    });
    setIsShowingOriginal(false);
    setIsLoading(false);
  };

  const toggleOriginal = async (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    if (isShowingOriginal()) {
      setIsShowingOriginal(false);
      return;
    }
    const originalMessageId = zoomedImage().original;
    const room = sellectedRoom();
    if (!room) return;
    //@ts-ignore
    const roomId = room.roomid;
    //@ts-ignore
    const type = room.type;
    const senderId = zoomedImage().senderId;
    if (!originalMessageId || !roomId || !type || !senderId) {
      console.error("画像のオリジナルを取得するための情報が不足しています");
      console.log(originalMessageId, roomId, type, senderId);
      return;
    }
    setIsLoading(true);
    try {
      const originalImage = await getMessage({
        messageid: originalMessageId,
        roomId,
        type,
        senderId,
      });
      const imageValue = JSON.parse(originalImage.value.content);
      setZoomedImage({
        ...zoomedImage(),
        imageUrl:
          `data:${imageValue.metadata.mimeType};base64,${imageValue.uri}`,
        filename: imageValue.metadata.filename,
      });
      setIsShowingOriginal(true);
    } catch (error) {
      console.error("オリジナル画像の読み込みに失敗しました:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownload = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    if (!zoomedImage().imageUrl) return;

    const link = document.createElement("a");
    link.href = zoomedImage().imageUrl as string;

    // ファイル名設定（filenameがなければ日時を使用）
    const filename = zoomedImage().filename ||
      `image_${new Date().toISOString().replace(/[:.]/g, "-")}`;

    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <>
      {zoomedImage().isOpen && (
        <div
          class="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50"
          onClick={closeViewer}
        >
          <div class="relative max-w-[90%] max-h-[90%]">
            <img
              src={zoomedImage().imageUrl!}
              alt="拡大画像"
              class="max-w-full max-h-[90vh] object-contain"
            />
            {isLoading() && (
              <div class="absolute inset-0 flex items-center justify-center bg-black bg-opacity-40">
                <div class="loading-spinner"></div>
              </div>
            )}
            <button
              class="absolute top-2 right-2 bg-white bg-opacity-70 rounded-full p-2 text-black hover:bg-opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                closeViewer();
              }}
            >
              ✕
            </button>
            <div class="absolute bottom-2 right-2 flex space-x-2">
              <button
                class="bg-white bg-opacity-70 rounded-md px-3 py-1 text-black hover:bg-opacity-100 text-sm flex items-center"
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
              {zoomedImage().original && (
                <button
                  class="bg-white bg-opacity-70 rounded-md px-3 py-1 text-black hover:bg-opacity-100 text-sm"
                  onClick={toggleOriginal}
                  disabled={isLoading()}
                >
                  {isShowingOriginal()
                    ? "サムネイルを表示"
                    : "オリジナルを表示"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function ImageCompornent({
  src,
  original,
  senderId,
  filename,
}: {
  src: string;
  original?: string;
  senderId: string;
  filename?: string;
}) {
  const [, setZoomedImage] = useAtom(zoomedImageState);

  const handleImageClick = () => {
    setZoomedImage({
      isOpen: true,
      original,
      imageUrl: src,
      senderId,
      filename,
    });
  };

  return (
    <div
      class="media-container inline-block"
      style={{ "max-width": "100%", margin: "4px 0" }}
    >
      <img
        src={src}
        alt="送信された画像"
        class="rounded cursor-pointer"
        style={{
          width: "100%",
          height: "auto",
          "max-width": "300px",
          "max-height": "500px",
          "object-fit": "contain",
          "box-shadow": "0 4px 8px rgba(0, 0, 0, 0.5)",
        }}
        onClick={handleImageClick}
      />
    </div>
  );
}
