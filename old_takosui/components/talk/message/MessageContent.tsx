import { createEffect, createSignal } from "solid-js";
import { ImageCompornent } from "./ImageViewer"; // ImageViewer.tsx 内で定義したコンポーネントを利用
import { DirectVideoPlayer } from "./VideoPlayer"; // VideoPlayer.tsx 内のコンポーネントを利用
import { VideoPlayerComponent } from "./VideoPlayer";

// 暗号化と署名検証の状態を表示するユーティリティ関数を追加
export function getSecurityStatus(encrypted: boolean, verified: boolean) {
  const encryptionStatus = encrypted
    ? { text: "暗号化済み", icon: "🔒", class: "text-green-600" }
    : { text: "暗号化なし", icon: "🔓", class: "text-yellow-600" };

  const verificationStatus = verified
    ? { text: "署名検証済み", icon: "🔏", class: "text-green-600" }
    : { text: "署名未検証", icon: "⚠️", class: "text-yellow-600" };

  return { encryptionStatus, verificationStatus };
}

export function renderMessageContent(
  content: {
    verified: boolean;
    encrypted: boolean;
    content: string;
    type: string;
    timestamp: string | number | Date;
    original?: string;
  },
  name: string,
) {
  switch (content.type) {
    case "text":
      return (
        <div class="c-talk-chat-msg" style={{ "user-select": "none" }}>
          <p>{convertLineBreak(content.content)}</p>
        </div>
      );
    case "image": {
      const contentValue = JSON.parse(content.content) as {
        uri: string;
        metadata: {
          filename: string;
          mimeType: string;
        };
      };
      return ImageCompornent({
        src:
          `data:${contentValue.metadata.mimeType};base64,${contentValue.uri}`,
        senderId: name,
        filename: contentValue.metadata.filename,
      });
    }
    case "video": {
      const contentValue = JSON.parse(content.content) as {
        uri: string;
        metadata: {
          filename: string;
          mimeType: string;
        };
      };
      return DirectVideoPlayer({
        videoUrl:
          `data:${contentValue.metadata.mimeType};base64,${contentValue.uri}`,
        videoType: contentValue.metadata.mimeType,
        filename: contentValue.metadata.filename,
      });
    }
    case "thumbnail": {
      const contentValue = JSON.parse(content.content) as {
        originalType: "image" | "video";
        thumbnailUri: string;
        thumbnailMimeType: string;
      };
      if (contentValue.originalType === "image") {
        return ImageCompornent({
          src:
            `data:${contentValue.thumbnailMimeType};base64,${contentValue.thumbnailUri}`,
          original: content.original,
          senderId: name,
        });
      }
      if (contentValue.originalType === "video") {
        return VideoPlayerComponent({
          content,
          senderName: name,
        });
      }
      return <></>;
    }
  }
}

// 補助関数（必要に応じてutilsに移動も可）
function convertLineBreak(message: string | null | undefined) {
  if (message === null || message === undefined) return;
  const messageValue = JSON.parse(message) as { text: string; format: string };
  if (messageValue.format === "text") {
    return messageValue.text.split("\n").map((line) => (
      <span>
        {line}
        <br />
      </span>
    ));
  }
  if (messageValue.format === "markdown") {
    return messageValue.text;
  }
}
