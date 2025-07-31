import { For, Match, Show, Switch } from "solid-js";
import { isUrl } from "../../utils/url.ts";
import type { ChatMessage } from "./types.ts";

interface ChatMessageListProps {
  messages: ChatMessage[];
  onReachTop: () => void;
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
      <ul class="p-2 md:p-4">
        <For each={props.messages}>
          {(message, i) => {
            const prev = props.messages[i() - 1];
            const isPrimary = !prev || prev.author !== message.author;
            return (
              <li
                class={`relative z-0 flex mt-[3px] ${
                  isPrimary ? "mt-[10px]" : ""
                } ${message.isMe ? "justify-end mr-3" : ""}`}
              >
                <div class="flex max-w-[80%]">
                  <Show when={!message.isMe && isPrimary}>
                    <div class="h-9 aspect-square">
                      {isUrl(message.avatar) ||
                          (typeof message.avatar === "string" &&
                            message.avatar.startsWith("data:image/"))
                        ? (
                          <img
                            src={message.avatar}
                            alt="avatar"
                            class="rounded-full"
                          />
                        )
                        : message.avatar}
                    </div>
                  </Show>
                  <div class="flex-grow">
                    <Show when={!message.isMe && isPrimary}>
                      <p class="text-[10px] font-bold my-[2px] ml-[10px] text-[#bbbbbb]">
                        {message.displayName}
                      </p>
                    </Show>
                    <div class="flex items-end">
                      <Show when={message.isMe}>
                        <span class="text-xs text-gray-500 mr-2">
                          {message.timestamp.toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </Show>
                      <div
                        class={`relative px-[12px] py-[6px] rounded-[12px] z-[2] text-[15px] leading-[20px] w-fit ${
                          message.isMe
                            ? "bg-[#ff3b3b] text-white shadow-[1px_1px_10px_rgba(0,0,0,0.2)]"
                            : "bg-[#3c3c3c] text-white shadow-[1px_1px_10px_rgba(0,0,0,0.2)]"
                        } ${
                          !message.isMe && isPrimary
                            ? "ml-[10px] rounded-tl-[2px]"
                            : ""
                        } ${!message.isMe && !isPrimary ? "ml-[46px]" : ""} ${
                          message.isMe && isPrimary ? "rounded-tr-[2px]" : ""
                        }`}
                      >
                        <Show when={message.content}>
                          <p class="w-fit max-w-full break-all">
                            {message.content}
                          </p>
                        </Show>
                        <Show
                          when={message.attachments &&
                            message.attachments.length > 0}
                        >
                          <div style="margin-top:4px;">
                            <For each={message.attachments}>
                              {(att) => (
                                <Switch
                                  fallback={
                                    <a
                                      href={att.data
                                        ? `data:${att.mediaType};base64,${att.data}`
                                        : att.url}
                                      download
                                      class="text-blue-400 underline"
                                    >
                                      ファイル
                                    </a>
                                  }
                                >
                                  <Match
                                    when={att.mediaType.startsWith("image/")}
                                  >
                                    <img
                                      src={att.data
                                        ? `data:${att.mediaType};base64,${att.data}`
                                        : att.url!}
                                      alt="image"
                                      style={{
                                        "max-width": "200px",
                                        "max-height": "200px",
                                      }}
                                    />
                                  </Match>
                                  <Match
                                    when={att.mediaType.startsWith("video/")}
                                  >
                                    <video
                                      src={att.data
                                        ? `data:${att.mediaType};base64,${att.data}`
                                        : att.url!}
                                      controls
                                      style={{
                                        "max-width": "200px",
                                        "max-height": "200px",
                                      }}
                                    />
                                  </Match>
                                  <Match
                                    when={att.mediaType.startsWith("audio/")}
                                  >
                                    <audio
                                      src={att.data
                                        ? `data:${att.mediaType};base64,${att.data}`
                                        : att.url!}
                                      controls
                                    />
                                  </Match>
                                </Switch>
                              )}
                            </For>
                          </div>
                        </Show>
                      </div>
                      <Show when={!message.isMe}>
                        <span class="text-xs text-gray-500 ml-2">
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
