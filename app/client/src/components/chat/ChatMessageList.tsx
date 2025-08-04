import { createEffect, createSignal, For, Match, onMount, Show, Switch } from "solid-js";
import { isUrl } from "../../utils/url.ts";
import type { ChatMessage } from "./types.ts";

interface MediaModalProps {
  src: string;
  mediaType: string;
  alt: string;
  isOpen: boolean;
  onClose: () => void;
}

function MediaModal(props: MediaModalProps) {
  let modalRef: HTMLDivElement | undefined;

  const handleBackdropClick = (e: MouseEvent) => {
    if (e.target === modalRef) {
      props.onClose();
    }
  };

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = props.src;
    link.download = '';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <Show when={props.isOpen}>
      <div
        ref={modalRef}
        class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-80"
        onClick={handleBackdropClick}
      >
        <div class="relative max-w-[90vw] max-h-[90vh] p-4">
          {/* 閉じるボタン */}
          <button
            type="button"
            onClick={props.onClose}
            class="absolute top-2 right-2 z-10 p-2 bg-black bg-opacity-50 rounded-full text-white hover:bg-opacity-70 transition-all"
          >
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {/* ダウンロードボタン */}
          <button
            type="button"
            onClick={handleDownload}
            class="absolute top-2 right-16 z-10 p-2 bg-black bg-opacity-50 rounded-full text-white hover:bg-opacity-70 transition-all"
          >
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
          </button>

          {/* メディアコンテンツ */}
          <div class="bg-white rounded-lg overflow-hidden">
            <Switch>
              <Match when={props.mediaType.startsWith("image/")}>
                <img
                  src={props.src}
                  alt={props.alt}
                  class="max-w-full max-h-[80vh] object-contain"
                />
              </Match>
              <Match when={props.mediaType.startsWith("video/")}>
                <video
                  src={props.src}
                  controls
                  autoplay
                  class="max-w-full max-h-[80vh]"
                />
              </Match>
            </Switch>
          </div>
        </div>
      </div>
    </Show>
  );
}

interface ChatMessageListProps {
  messages: ChatMessage[];
  onReachTop: () => void;
  shouldScrollToBottom?: boolean;
}

interface LazyImageProps {
  src: string;
  alt: string;
  class?: string;
  style?: Record<string, string>;
}

function LazyImage(props: LazyImageProps) {
  const [loaded, setLoaded] = createSignal(false);
  const [error, setError] = createSignal(false);
  const [intersecting, setIntersecting] = createSignal(false);
  let imgRef: HTMLImageElement | undefined;

  onMount(() => {
    if (imgRef) {
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting) {
            setIntersecting(true);
            imgRef!.src = props.src;
            observer.disconnect();
          }
        },
        { threshold: 0.1 },
      );
      observer.observe(imgRef);
    }
  });

  const handleLoad = () => {
    setLoaded(true);
    // 画像読み込み完了時にスクロール位置を維持
    const event = new CustomEvent('mediaLoaded');
    globalThis.dispatchEvent(event);
  };

  const handleError = () => {
    setError(true);
    // エラー時もスクロール位置を維持
    const event = new CustomEvent('mediaLoaded');
    globalThis.dispatchEvent(event);
  };

  return (
    <div class="relative" style={props.style}>
      {/* プレースホルダー背景 */}
      <div 
        class="absolute inset-0 bg-gray-300 rounded flex items-center justify-center"
        style={props.style}
      >
        <svg class="w-12 h-12 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      </div>
      
      <img
        ref={imgRef}
        alt={props.alt}
        class={`relative z-10 transition-opacity duration-300 ${props.class || ""} ${
          loaded() ? "opacity-100" : "opacity-0"
        }`}
        style={props.style}
        onLoad={handleLoad}
        onError={handleError}
      />
      
      <Show when={intersecting() && !loaded() && !error()}>
        <div
          class="absolute inset-0 z-20 bg-gray-700 bg-opacity-50 rounded flex items-center justify-center"
          style={props.style}
        >
          <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-white">
          </div>
        </div>
      </Show>
      
      <Show when={error()}>
        <div
          class="absolute inset-0 z-20 bg-gray-700 rounded flex items-center justify-center text-gray-400 text-sm"
          style={props.style}
        >
          画像を読み込めません
        </div>
      </Show>
    </div>
  );
}

export function ChatMessageList(props: ChatMessageListProps) {
  let listRef: HTMLDivElement | undefined;
  let isInitialLoad = true;
  let lastScrollHeight = 0;
  let lastScrollTop = 0;
  let isUserScrolling = false;

  // モーダル状態管理
  const [modalOpen, setModalOpen] = createSignal(false);
  const [modalSrc, setModalSrc] = createSignal("");
  const [modalMediaType, setModalMediaType] = createSignal("");
  const [modalAlt, setModalAlt] = createSignal("");

  const openModal = (src: string, mediaType: string, alt: string) => {
    setModalSrc(src);
    setModalMediaType(mediaType);
    setModalAlt(alt);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
  };

  const scrollToBottom = (smooth = false) => {
    if (listRef) {
      const targetScrollTop = listRef.scrollHeight - listRef.clientHeight;
      listRef.scrollTo({
        top: targetScrollTop,
        behavior: smooth ? "smooth" : "auto",
      });
    }
  };

  // メディア読み込み時のスクロール位置維持
  const handleMediaLoaded = () => {
    if (!listRef || isInitialLoad || isUserScrolling) return;
    
    const currentScrollHeight = listRef.scrollHeight;
    const heightDiff = currentScrollHeight - lastScrollHeight;
    
    if (heightDiff > 0) {
      // 現在のスクロール位置を維持
      listRef.scrollTop = lastScrollTop + heightDiff;
    }
    
    lastScrollHeight = currentScrollHeight;
    lastScrollTop = listRef.scrollTop;
  };

  // メディア読み込みイベントをリッスン
  onMount(() => {
    globalThis.addEventListener('mediaLoaded', handleMediaLoaded);
    return () => {
      globalThis.removeEventListener('mediaLoaded', handleMediaLoaded);
    };
  });

  // メッセージの変更を監視してスクロールを制御
  createEffect(() => {
    const messages = props.messages;
    
    if (messages.length === 0) {
      isInitialLoad = true;
      return;
    }

    // DOM更新を待ってからスクロール処理を実行
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!listRef) return;

        const currentScrollHeight = listRef.scrollHeight;
        const isAtBottom = listRef.scrollTop + listRef.clientHeight >= lastScrollHeight - 10;

        // 初回読み込み時は必ず最下部にスクロール
        if (isInitialLoad) {
          scrollToBottom(false);
          isInitialLoad = false;
        }
        // 既に最下部付近にいる場合は新しいメッセージで最下部に移動
        else if (isAtBottom || currentScrollHeight > lastScrollHeight) {
          scrollToBottom(true);
        }

        lastScrollHeight = currentScrollHeight;
        lastScrollTop = listRef.scrollTop;
      });
    });
  });

  // 初回マウント時の処理
  onMount(() => {
    // マウント後にメッセージがある場合は最下部にスクロール
    if (props.messages.length > 0) {
      setTimeout(() => {
        scrollToBottom(false);
        isInitialLoad = false;
      }, 100);
    }
  });

  return (
    <>
      <div
        class="flex-grow overflow-y-auto pt-[48px]"
        style={{ 
          "scroll-padding-block-start": "200px",
          "scroll-behavior": "auto"
        }}
        ref={(el) => {
          listRef = el;
          // refが設定された直後にスクロール位置を調整
          if (el && props.messages.length > 0) {
            setTimeout(() => scrollToBottom(false), 50);
          }
        }}
        onScroll={() => {
          if (!listRef) return;
          
          // ユーザーがスクロールしていることを記録
          isUserScrolling = true;
          lastScrollTop = listRef.scrollTop;
          
          // スクロールが停止した後、フラグをリセット
          setTimeout(() => {
            isUserScrolling = false;
          }, 150);
          
          if (listRef.scrollTop < 100) props.onReachTop();
        }}
      >
      <ul>
        <For each={props.messages}>
          {(message, i) => {
            const prev = props.messages[i() - 1];
            const isPrimary = !prev || prev.author !== message.author;
            return (
              <li
                class={`relative z-0 flex ${
                  isPrimary ? "mt-[16px]" : "mt-[2px]"
                } ${message.isMe ? "justify-end mr-3" : "ml-3"}`}
              >
                <div class="flex max-w-[85%] md:max-w-[70%]">
                  <Show when={!message.isMe && isPrimary}>
                    <div class="h-8 w-8 mr-1 flex-shrink-0">
                      {isUrl(message.avatar) ||
                          (typeof message.avatar === "string" &&
                            message.avatar.startsWith("data:image/"))
                        ? (
                          <img
                            src={message.avatar}
                            alt="avatar"
                            class="rounded-full w-full h-full object-cover"
                          />
                        )
                        : (
                          <div class="w-full h-full bg-gray-600 rounded-full flex items-center justify-center text-white text-sm font-semibold">
                            {message.displayName.charAt(0).toUpperCase()}
                          </div>
                        )}
                    </div>
                  </Show>
                  <div class="flex-grow">
                    <Show when={!message.isMe && isPrimary}>
                      <div class="flex items-center mb-1 ml-1">
                        <p class="text-xs font-semibold text-[#8E8E93]">
                          {message.displayName}
                        </p>
                        <span class="text-[10px] text-[#8E8E93] ml-2">
                          {message.timestamp.toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                    </Show>
                    <div class="flex items-end">
                      <Show when={message.isMe}>
                        <span class="text-[11px] text-[#8E8E93] mr-2 mb-1">
                          {message.timestamp.toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </Show>
                      <div
                        class={`flex flex-col space-y-1 ${
                          message.isMe ? "items-end" : "items-start"
                        }`}
                      >
                        {/* メッセージコンテンツ */}
                        <Show when={message.content && message.content.trim()}>
                          <div
                            class={`relative px-[12px] py-[6px] rounded-[12px] z-[2] text-[15px] leading-[20px] w-fit ${
                              message.isMe
                                ? "bg-[#ff3b3b] text-white shadow-[1px_1px_10px_rgba(0,0,0,0.2)]"
                                : "bg-[#3c3c3c] text-white shadow-[1px_1px_10px_rgba(0,0,0,0.2)]"
                            } ${
                              !message.isMe && isPrimary
                                ? "ml-[4px] rounded-tl-[2px]"
                                : ""
                            } ${
                              !message.isMe && !isPrimary ? "ml-[40px]" : ""
                            } ${
                              message.isMe && isPrimary
                                ? "rounded-tr-[2px]"
                                : ""
                            }`}
                          >
                            <p class="break-words whitespace-pre-wrap">
                              {message.content}
                            </p>
                          </div>
                        </Show>

                        {/* アタッチメント */}
                        <Show
                          when={message.attachments &&
                            message.attachments.length > 0}
                        >
                          <div
                            class={`flex flex-col space-y-1 ${
                              message.isMe ? "items-end" : "items-start"
                            } ${
                              !message.isMe && isPrimary ? "ml-[4px]" : ""
                            } ${
                              !message.isMe && !isPrimary ? "ml-[40px]" : ""
                            }`}
                          >
                            <For each={message.attachments}>
                              {(att) => (
                                <div class="w-fit">
                                  <Switch
                                    fallback={
                                      <div class="bg-white rounded-lg p-3 shadow-sm border max-w-[280px]">
                                        <div class="flex items-center space-x-3">
                                          <div class="flex-shrink-0">
                                            <svg
                                              class="w-8 h-8 text-gray-500"
                                              fill="none"
                                              stroke="currentColor"
                                              viewBox="0 0 24 24"
                                            >
                                              <path
                                                stroke-linecap="round"
                                                stroke-linejoin="round"
                                                stroke-width="2"
                                                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                                              />
                                            </svg>
                                          </div>
                                          <div class="flex-grow min-w-0">
                                            <p class="text-sm font-medium text-gray-900 truncate">
                                              {att.mediaType || "ファイル"}
                                            </p>
                                            <p class="text-xs text-gray-500">
                                              タップしてダウンロード
                                            </p>
                                          </div>
                                          <a
                                            href={att.data
                                              ? `data:${att.mediaType};base64,${att.data}`
                                              : att.url}
                                            download=""
                                            class="flex-shrink-0 p-1 text-blue-500 hover:text-blue-600 transition-colors"
                                          >
                                            <svg
                                              class="w-5 h-5"
                                              fill="none"
                                              stroke="currentColor"
                                              viewBox="0 0 24 24"
                                            >
                                              <path
                                                stroke-linecap="round"
                                                stroke-linejoin="round"
                                                stroke-width="2"
                                                d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                                              />
                                            </svg>
                                          </a>
                                        </div>
                                      </div>
                                    }
                                  >
                                    <Match
                                      when={att.mediaType.startsWith("image/")}
                                    >
                                      <div 
                                        class="relative group bg-white rounded-lg overflow-hidden shadow-sm border cursor-pointer"
                                        onClick={() => openModal(
                                          att.data ? `data:${att.mediaType};base64,${att.data}` : att.url!,
                                          att.mediaType,
                                          "添付画像"
                                        )}
                                      >
                                        <LazyImage
                                          src={att.data
                                            ? `data:${att.mediaType};base64,${att.data}`
                                            : att.url!}
                                          alt="添付画像"
                                          class="cursor-pointer"
                                          style={{
                                            "width": "280px",
                                            "height": "200px",
                                            "object-fit": "cover",
                                          }}
                                        />
                                        {/* プレビュー用のオーバーレイ */}
                                        <div class="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-20 transition-all flex items-center justify-center">
                                          <div class="opacity-0 group-hover:opacity-100 transition-opacity">
                                            <svg class="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                            </svg>
                                          </div>
                                        </div>
                                      </div>
                                    </Match>
                                    <Match
                                      when={att.mediaType.startsWith("video/")}
                                    >
                                      <div 
                                        class="relative group bg-white rounded-lg overflow-hidden shadow-sm border cursor-pointer"
                                        onClick={() => openModal(
                                          att.data ? `data:${att.mediaType};base64,${att.data}` : att.url!,
                                          att.mediaType,
                                          "添付動画"
                                        )}
                                      >
                                        {/* 動画プレースホルダー背景 */}
                                        <div 
                                          class="absolute inset-0 bg-gray-300 flex items-center justify-center"
                                          style={{
                                            "width": "280px",
                                            "height": "200px",
                                          }}
                                        >
                                          <svg class="w-16 h-16 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                          </svg>
                                        </div>
                                        
                                        <video
                                          src={att.data
                                            ? `data:${att.mediaType};base64,${att.data}`
                                            : att.url!}
                                          preload="metadata"
                                          muted
                                          class="relative z-10"
                                          style={{
                                            "width": "280px",
                                            "height": "200px",
                                            "object-fit": "cover",
                                          }}
                                          onLoadedMetadata={() => {
                                            const event = new CustomEvent('mediaLoaded');
                                            globalThis.dispatchEvent(event);
                                          }}
                                        />
                                        {/* プレビュー用のオーバーレイ */}
                                        <div class="absolute inset-0 z-20 bg-black bg-opacity-20 group-hover:bg-opacity-40 transition-all flex items-center justify-center">
                                          <div class="opacity-80 group-hover:opacity-100 transition-opacity">
                                            <svg class="w-16 h-16 text-white" fill="currentColor" viewBox="0 0 24 24">
                                              <path d="M8 5v14l11-7z"/>
                                            </svg>
                                          </div>
                                        </div>
                                      </div>
                                    </Match>
                                    <Match
                                      when={att.mediaType.startsWith("audio/")}
                                    >
                                      <div class="bg-white rounded-lg p-3 shadow-sm border max-w-[280px]">
                                        <div class="flex items-center space-x-3 mb-2">
                                          <div class="flex-shrink-0">
                                            <svg
                                              class="w-6 h-6 text-gray-500"
                                              fill="none"
                                              stroke="currentColor"
                                              viewBox="0 0 24 24"
                                            >
                                              <path
                                                stroke-linecap="round"
                                                stroke-linejoin="round"
                                                stroke-width="2"
                                                d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
                                              />
                                            </svg>
                                          </div>
                                          <p class="text-sm font-medium text-gray-900 flex-grow">
                                            音声ファイル
                                          </p>
                                          <a
                                            href={att.data
                                              ? `data:${att.mediaType};base64,${att.data}`
                                              : att.url!}
                                            download=""
                                            class="flex-shrink-0 p-1 text-blue-500 hover:text-blue-600 transition-colors"
                                          >
                                            <svg
                                              class="w-4 h-4"
                                              fill="none"
                                              stroke="currentColor"
                                              viewBox="0 0 24 24"
                                            >
                                              <path
                                                stroke-linecap="round"
                                                stroke-linejoin="round"
                                                stroke-width="2"
                                                d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                                              />
                                            </svg>
                                          </a>
                                        </div>
                                        <audio
                                          src={att.data
                                            ? `data:${att.mediaType};base64,${att.data}`
                                            : att.url!}
                                          controls
                                          preload="metadata"
                                          class="w-full"
                                          onLoadedMetadata={() => {
                                            const event = new CustomEvent('mediaLoaded');
                                            globalThis.dispatchEvent(event);
                                          }}
                                        />
                                      </div>
                                    </Match>
                                  </Switch>
                                </div>
                              )}
                            </For>
                          </div>
                        </Show>
                      </div>
                      <Show when={!message.isMe && !isPrimary}>
                        <span class="text-[11px] text-[#8E8E93] ml-2 mb-1">
                          {message.timestamp.toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </Show>
                    </div>
                  </div>
                </div>
              </li>
            );
          }}
        </For>
      </ul>
      </div>
      
      {/* メディアモーダル */}
      <MediaModal
        src={modalSrc()}
        mediaType={modalMediaType()}
        alt={modalAlt()}
        isOpen={modalOpen()}
        onClose={closeModal}
      />
    </>
  );
}
