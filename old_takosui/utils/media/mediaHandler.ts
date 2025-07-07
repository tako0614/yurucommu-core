import { createRoot } from "solid-js";
import { useAtom, useSetAtom } from "solid-jotai";
import {
  currentOperationAtom,
  isMenuOpenAtom,
  isSendingAtom,
  readFileAsBase64,
  sendHandler,
  sendingProgressAtom,
} from "../message/messageUtils.tsx";
import { getBase64SizeKB, resizeBase64Image } from "./resizeImage.ts";
import { generateThumbnailFromFile } from "./getVideoThumbnail.ts";
import {
  pasteImageDataAtom,
  pasteImagePreviewAtom,
  showPasteConfirmAtom,
} from "../../components/talk/send/ImagePasteConfirmModal.tsx";
import {
  createMediaContent,
  createThumbnailContent,
} from "../message/getMessage.ts";

export const handleImageFile = async (file: File) => {
  return createRoot(async () => {
    const [isSending, setIsSending] = useAtom(isSendingAtom);
    const [sendingProgress, setSendingProgress] = useAtom(sendingProgressAtom);
    const [currentOperation, setCurrentOperation] = useAtom(
      currentOperationAtom,
    );

    const fileSizeKB = file.size / 1024;

    if (fileSizeKB > 256) {
      setIsSending(true);
      setCurrentOperation("画像を処理中...");
      setSendingProgress(10);

      const base64Image = await readFileAsBase64(file);
      setSendingProgress(30);

      const replaced = base64Image.replace(/^data:.*?;base64,/, "");
      const contentRaw = createMediaContent({
        uri: replaced,
        metadata: {
          filename: file.name,
          mimeType: file.type,
        },
      });

      setSendingProgress(50);
      setCurrentOperation("元の画像を送信中...");

      const big = contentRaw;
      const messageId = await sendHandler({
        type: "image",
        content: big,
        isLarge: true,
      });

      setSendingProgress(70);
      setCurrentOperation("サムネイルを生成中...");

      const resizedImage = (await resizeBase64Image(base64Image, 256)).replace(
        /^data:.*?;base64,/,
        "",
      );
      const content = createThumbnailContent({
        originalType: "image",
        thumbnailMimeType: file.type,
        thumbnailUri: resizedImage,
      });

      setCurrentOperation("サムネイルを送信中...");
      setSendingProgress(90);

      await sendHandler({
        type: "thumbnail",
        content,
        isLarge: false,
        original: messageId,
      });

      setIsSending(false);
      setSendingProgress(0);
    } else {
      // 256KB以下の場合は圧縮せずに送信
      console.log("画像サイズが256KB以下のため圧縮せずに送信します");
      const base64Data = await readFileAsBase64(file, true);
      const content = createMediaContent({
        uri: base64Data,
        metadata: {
          filename: file.name,
          mimeType: file.type,
        },
      });
      await sendHandler({
        type: "image",
        content,
      });
    }
  });
};

export const handleVideoFile = async (file: File) => {
  return createRoot(async () => {
    const [isSending, setIsSending] = useAtom(isSendingAtom);
    const [sendingProgress, setSendingProgress] = useAtom(sendingProgressAtom);
    const [currentOperation, setCurrentOperation] = useAtom(
      currentOperationAtom,
    );

    const maxVideoSizeMB = 10000;
    const fileSizeMB = file.size / (1024 * 1024);
    const fileSizeKB = file.size / 1024;

    if (fileSizeMB > maxVideoSizeMB) {
      console.error(`動画サイズが上限（${maxVideoSizeMB}MB）を超えています`);
      return;
    }

    // 256KB以下の場合は圧縮せずにサムネイルなしで直接送信
    if (fileSizeKB <= 256) {
      console.log("動画サイズが256KB以下のため圧縮せずに送信します");
      const base64Data = await readFileAsBase64(file, true);
      const content = createMediaContent({
        uri: base64Data,
        metadata: {
          filename: file.name,
          mimeType: file.type,
        },
      });
      await sendHandler({
        type: "video",
        content,
      });
      return;
    }

    // 256KB以上の場合の処理
    setIsSending(true);
    setCurrentOperation("動画を処理中...");
    setSendingProgress(10);

    const base64Video = await readFileAsBase64(file);
    setSendingProgress(40);

    const videoContent = base64Video.replace(/^data:.*?;base64,/, "");
    setCurrentOperation("動画を送信中...");
    setSendingProgress(50);

    // 元の動画を送信
    const messageId = await sendHandler({
      type: "video",
      content: createMediaContent({
        uri: videoContent,
        metadata: {
          filename: file.name,
          mimeType: file.type,
        },
      }),
      isLarge: true,
    });

    // 動画のサムネイル生成と送信
    try {
      setCurrentOperation("サムネイルを生成中...");
      setSendingProgress(80);

      const thumbnailBase64 = await generateThumbnailFromFile(file, 0);
      // 256KB以上の場合は圧縮
      let resizedThumbnailBase64 = thumbnailBase64;
      if (getBase64SizeKB(thumbnailBase64) > 256) {
        resizedThumbnailBase64 = await resizeBase64Image(thumbnailBase64, 256);
      }

      setCurrentOperation("サムネイルを送信中...");
      setSendingProgress(90);

      const thumbnailContent = createThumbnailContent({
        originalType: "video",
        thumbnailMimeType: "image/jpeg",
        thumbnailUri: resizedThumbnailBase64.replace(/^data:.*?;base64,/, ""),
      });
      await sendHandler({
        type: "thumbnail",
        content: thumbnailContent,
        isLarge: false,
        original: messageId,
      });
    } catch (err) {
      console.error("動画サムネイル生成に失敗しました:", err);
    } finally {
      setIsSending(false);
      setSendingProgress(0);
    }
  });
};

export const handleMediaSelect = () => {
  createRoot(() => {
    const [isMenuOpen, setIsMenuOpen] = useAtom(isMenuOpenAtom);

    setIsMenuOpen(false);

    // ファイル入力要素の作成
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*,video/*"; // 画像と動画ファイルを許可
    fileInput.style.display = "none";

    // ファイル選択イベントハンドラを設定
    fileInput.addEventListener("change", async (event) => {
      console.log("ファイル選択完了");
      const target = event.target as HTMLInputElement;
      const file = target.files?.[0];

      if (!file) return;

      try {
        // ファイルタイプを確認
        const isVideo = file.type.startsWith("video/");
        const isImage = file.type.startsWith("image/");

        if (!isVideo && !isImage) {
          console.error("サポートされていないファイル形式です");
          return;
        }

        // ファイルサイズをメガバイト単位で計算
        const fileSizeMB = file.size / (1024 * 1024);
        console.log(`ファイルサイズ: ${fileSizeMB.toFixed(2)}MB`);

        if (isImage) {
          // 画像処理
          await handleImageFile(file);
        } else if (isVideo) {
          // 動画処理
          await handleVideoFile(file);
        }
      } catch (error) {
        console.error("メディア処理中にエラーが発生しました:", error);
      }
    });

    // bodyに追加して自動的にクリックイベントを発火
    document.body.appendChild(fileInput);
    fileInput.click();

    // 使用後にDOMから削除
    setTimeout(() => {
      document.body.removeChild(fileInput);
    }, 3000);
  });
};

// クリップボードからの画像処理関数（確認モーダル表示）
export const handlePastedImage = async (event: ClipboardEvent) => {
  // クリップボードにデータがあるか確認
  if (!event.clipboardData || !event.clipboardData.items) {
    return false;
  }

  // クリップボードアイテムを取得
  const items = event.clipboardData.items;

  for (let i = 0; i < items.length; i++) {
    // 画像データを探す
    if (items[i].type.indexOf("image") !== -1) {
      // 画像データをファイルとして取得
      const file = items[i].getAsFile();

      if (file) {
        // デフォルトのイベントをキャンセル（テキストエリアへの貼り付けを防止）
        event.preventDefault();

        try {
          // 確認モーダル用に画像データを保存
          createRoot(async () => {
            const [, setPasteImageData] = useAtom(pasteImageDataAtom);
            const [, setPasteImagePreview] = useAtom(pasteImagePreviewAtom);
            const [, setShowPasteConfirm] = useAtom(showPasteConfirmAtom);

            // 画像プレビュー用にデータURLを生成
            const imageUrl = URL.createObjectURL(file);

            // ファイルとプレビューURLを状態に保存
            setPasteImageData(file);
            setPasteImagePreview(imageUrl);
            setShowPasteConfirm(true);
          });

          return true; // 画像処理成功
        } catch (error) {
          console.error(
            "クリップボード画像の処理中にエラーが発生しました:",
            error,
          );
        }
      }
    }
  }

  return false; // 画像が見つからなかったか、処理に失敗した
};

// 確認モーダルから送信が実行された場合の処理
export const confirmAndSendPastedImage = async () => {
  return createRoot(async () => {
    const [pasteImageData] = useAtom(pasteImageDataAtom);
    const [pasteImagePreview, setPasteImagePreview] = useAtom(
      pasteImagePreviewAtom,
    );
    const [, setShowPasteConfirm] = useAtom(showPasteConfirmAtom);

    if (pasteImageData) {
      try {
        // 既存の画像処理関数を使用して送信
        await handleImageFile(pasteImageData()!);
      } catch (error) {
        console.error("貼り付けた画像の送信中にエラーが発生しました:", error);
      } finally {
        // クリーンアップ
        if (pasteImagePreview) {
          URL.revokeObjectURL(pasteImagePreview()!);
          setPasteImagePreview(null);
        }
        setShowPasteConfirm(false);
      }
    }
  });
};

// 貼り付け確認キャンセル時の処理
export const cancelPastedImage = () => {
  createRoot(() => {
    const [pasteImagePreview, setPasteImagePreview] = useAtom(
      pasteImagePreviewAtom,
    );
    const [, setPasteImageData] = useAtom(pasteImageDataAtom);
    const [, setShowPasteConfirm] = useAtom(showPasteConfirmAtom);

    // リソース解放
    if (pasteImagePreview) {
      URL.revokeObjectURL(pasteImagePreview()!);
      setPasteImagePreview(null);
    }

    setPasteImageData(null);
    setShowPasteConfirm(false);
  });
};
