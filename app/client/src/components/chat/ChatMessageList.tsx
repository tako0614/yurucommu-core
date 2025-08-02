import { createSignal, For, Match, onMount, Show, Switch } from "solid-js";
import { isUrl } from "../../utils/url.ts";
import type { ChatMessage } from "./types.ts";

interface ChatMessageListProps {
  messages: ChatMessage[];
  onReachTop: () => void;
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
  let imgRef: HTMLImageElement | undefined;

  onMount(() => {
    if (imgRef) {
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting) {
            imgRef!.src = props.src;
            observer.disconnect();
          }
        },
        { threshold: 0.1 },
      );
      observer.observe(imgRef);
    }
  });

  return (
    <div class="relative">
      <img
        ref={imgRef}
        alt={props.alt}
        class={`transition-opacity duration-300 ${props.class || ""} ${
          loaded() ? "opacity-100" : "opacity-0"
        }`}
        style={props.style}
        onLoad={() => setLoaded(true)}
        onError={() => setError(true)}
      />
      <Show when={!loaded() && !error()}>
        <div
          class="absolute inset-0 bg-gray-700 rounded flex items-center justify-center"
          style={props.style}
        >
          <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-white">
          </div>
        </div>
      </Show>
      <Show when={error()}>
        <div
          class="absolute inset-0 bg-gray-700 rounded flex items-center justify-center text-gray-400 text-sm"
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

  return (
    <div
      class="flex-grow overflow-y-auto pt-[48px]"
      style={{ "scroll-padding-block-start": "200px" }}
      ref={(el) => (listRef = el)}
      onScroll={() => {
        if (!listRef) return;
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
                    <div class="h-8 w-8 mr-2 flex-shrink-0">
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
                      <div class="flex items-center mb-1 ml-2">
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
                                ? "ml-[10px] rounded-tl-[2px]"
                                : ""
                            } ${
                              !message.isMe && !isPrimary ? "ml-[46px]" : ""
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
                              !message.isMe && isPrimary ? "ml-[10px]" : ""
                            } ${
                              !message.isMe && !isPrimary ? "ml-[46px]" : ""
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
                                      <div class="relative group bg-white rounded-lg overflow-hidden shadow-sm border">
                                        <LazyImage
                                          src={att.data
                                            ? `data:${att.mediaType};base64,${att.data}`
                                            : att.url!}
                                          alt="添付画像"
                                          class="cursor-pointer"
                                          style={{
                                            "max-width": "280px",
                                            "max-height": "300px",
                                            "object-fit": "cover",
                                          }}
                                        />
                                        <div class="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                          <a
                                            href={att.data
                                              ? `data:${att.mediaType};base64,${att.data}`
                                              : att.url!}
                                            download=""
                                            class="p-2 bg-black bg-opacity-50 rounded-full text-white hover:bg-opacity-70 transition-all"
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
                                      </div>
                                    </Match>
                                    <Match
                                      when={att.mediaType.startsWith("video/")}
                                    >
                                      <div class="relative bg-white rounded-lg overflow-hidden shadow-sm border">
                                        <video
                                          src={att.data
                                            ? `data:${att.mediaType};base64,${att.data}`
                                            : att.url!}
                                          controls
                                          preload="metadata"
                                          style={{
                                            "max-width": "280px",
                                            "max-height": "300px",
                                          }}
                                        />
                                        <div class="absolute top-2 right-2">
                                          <a
                                            href={att.data
                                              ? `data:${att.mediaType};base64,${att.data}`
                                              : att.url!}
                                            download=""
                                            class="p-2 bg-black bg-opacity-50 rounded-full text-white hover:bg-opacity-70 transition-all"
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
  );
}
