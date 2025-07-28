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
      class="p-talk-chat-main flex-grow overflow-y-auto pt-[48px]"
      ref={(el) => (listRef = el)}
      onScroll={() => {
        if (!listRef) return;
        if (listRef.scrollTop < 100) props.onReachTop();
      }}
    >
      <ul class="p-talk-chat-main__ul">
        <For each={props.messages}>
          {(message, i) => {
            const prev = props.messages[i() - 1];
            const isPrimary = !prev || prev.author !== message.author;
            const cls = `c-talk-chat ${message.isMe ? "self" : "other"} ${
              isPrimary ? "primary" : "subsequent"
            }`;
            return (
              <li class={cls}>
                <div class="c-talk-chat-box">
                  <Show when={!message.isMe && isPrimary}>
                    <div class="c-talk-chat-icon">
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
                  <div class="c-talk-chat-right">
                    <Show when={!message.isMe && isPrimary}>
                      <p class="c-talk-chat-name">{message.displayName}</p>
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
                      <div class="c-talk-chat-msg">
                        <Show when={message.content}>
                          <p>{message.content}</p>
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
