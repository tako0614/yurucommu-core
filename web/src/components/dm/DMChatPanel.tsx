import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { A } from "@solidjs/router";
import { Actor, DMMessage } from "../../types/index.ts";
import {
  CommunityMessage,
  DMContact,
  fetchCommunityMessages,
  fetchUserDMMessages,
  fetchUserDMTyping,
  markDMAsRead,
  sendCommunityMessage,
  sendUserDMMessage,
  sendUserDMTyping,
} from "../../lib/api.ts";
import { formatTime } from "../../lib/datetime.ts";
import { useI18n } from "../../lib/i18n.tsx";

interface DMChatPanelProps {
  contact: DMContact;
  actor: Actor;
  onBack: () => void;
  onRead?: () => void;
}

export function DMChatPanel(props: DMChatPanelProps) {
  const [messages, setMessages] = createSignal<
    (DMMessage | CommunityMessage)[]
  >([]);
  const [loading, setLoading] = createSignal(true);
  const [input, setInput] = createSignal("");
  const [sending, setSending] = createSignal(false);
  const [isTyping, setIsTyping] = createSignal(false);
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null);
  let messagesEndRef!: HTMLDivElement;
  let lastTypingSent = 0;
  const { t } = useI18n();

  createEffect(() => {
    const contactApId = props.contact.ap_id;
    const contactType = props.contact.type;
    let cancelled = false;

    const loadMessages = async () => {
      setErrorMessage(null);
      setLoading(true);
      try {
        if (contactType === "community") {
          const data = await fetchCommunityMessages(contactApId);
          if (!cancelled) {
            setMessages(data);
          }
        } else {
          const { messages: loadedMessages } =
            await fetchUserDMMessages(contactApId);
          if (!cancelled) {
            setMessages(loadedMessages);
          }
          try {
            await markDMAsRead(contactApId);
            if (!cancelled) {
              props.onRead?.();
            }
          } catch {
            // Ignore read marking errors.
          }
        }
      } catch (e) {
        if (!cancelled) {
          console.error("Failed to load messages:", e);
          setErrorMessage(t("common.error"));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadMessages();

    onCleanup(() => {
      cancelled = true;
    });
  });

  createEffect(() => {
    // Track messages to scroll on change
    messages();
    messagesEndRef?.scrollIntoView({ behavior: "smooth" });
  });

  createEffect(() => {
    const contactApId = props.contact.ap_id;
    const contactType = props.contact.type;

    if (contactType !== "user") {
      setIsTyping(false);
      return;
    }

    let cancelled = false;
    const pollTyping = async () => {
      try {
        const typing = await fetchUserDMTyping(contactApId);
        if (!cancelled) {
          setIsTyping(typing.is_typing);
        }
      } catch {
        if (!cancelled) {
          setIsTyping(false);
        }
      }
    };

    pollTyping();
    const intervalId = window.setInterval(pollTyping, 4000);
    onCleanup(() => {
      cancelled = true;
      window.clearInterval(intervalId);
    });
  });

  const sendTyping = async (value: string) => {
    if (props.contact.type !== "user") return;
    if (!value.trim()) return;
    const now = Date.now();
    if (now - lastTypingSent < 2000) return;
    lastTypingSent = now;
    try {
      await sendUserDMTyping(props.contact.ap_id);
    } catch (e) {
      console.error("Failed to send typing:", e);
    }
  };

  const handleSend = async (e: SubmitEvent) => {
    e.preventDefault();
    if (!input().trim() || sending()) return;

    setSending(true);
    setErrorMessage(null);
    try {
      if (props.contact.type === "community") {
        const newMsg = await sendCommunityMessage(
          props.contact.ap_id,
          input().trim(),
        );
        setMessages((prev) => [...prev, newMsg]);
      } else {
        const { message } = await sendUserDMMessage(
          props.contact.ap_id,
          input().trim(),
        );
        setMessages((prev) => [...prev, message]);
      }
      setInput("");
    } catch (e) {
      console.error("Failed to send message:", e);
      setErrorMessage(t("common.error"));
    } finally {
      setSending(false);
    }
  };

  const handleInputChange = (
    e: InputEvent & { currentTarget: HTMLInputElement },
  ) => {
    const value = e.currentTarget.value;
    setInput(value);
    void sendTyping(value);
  };

  const getSenderApId = (msg: DMMessage | CommunityMessage): string => {
    return msg.sender.ap_id;
  };

  return (
    <div class="flex flex-col h-full">
      <div class="flex items-center gap-3 px-4 py-3 border-b border-neutral-900 bg-neutral-900/80 backdrop-blur-sm">
        <button
          onClick={props.onBack}
          aria-label="Back"
          class="text-neutral-400 hover:text-white transition-colors"
        >
          <svg
            class="w-6 h-6"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </button>
        <Show
          when={props.contact.icon_url}
          fallback={
            <div class="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white font-bold">
              {(props.contact.name ||
                props.contact.preferred_username)?.[0]?.toUpperCase() || "?"}
            </div>
          }
        >
          <img
            src={props.contact.icon_url ?? undefined}
            alt={props.contact.name || props.contact.preferred_username}
            class="w-10 h-10 rounded-full object-cover"
          />
        </Show>
        <div class="flex-1 min-w-0">
          <div class="font-semibold text-white truncate">
            {props.contact.name || props.contact.preferred_username}
          </div>
          <div class="text-xs text-neutral-500 truncate">
            @{props.contact.preferred_username}
            <Show
              when={
                props.contact.type === "community" &&
                props.contact.member_count !== undefined
              }
            >
              <span class="ml-2">
                {t("dm.memberCount").replace(
                  "{count}",
                  String(props.contact.member_count),
                )}
              </span>
            </Show>
          </div>
        </div>
        <Show when={props.contact.type === "community"}>
          <A
            href={`/groups/${encodeURIComponent(props.contact.preferred_username)}`}
            aria-label={t("dm.openCommunityProfile")}
            title={t("dm.openCommunityProfile")}
            class="flex-shrink-0 p-2 text-neutral-400 hover:text-white transition-colors"
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
                stroke-width={2}
                d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
              />
            </svg>
          </A>
        </Show>
      </div>

      <div class="flex-1 overflow-y-auto px-4 py-4">
        <Show
          when={!loading()}
          fallback={<div class="text-center text-neutral-500">Loading...</div>}
        >
          <Show
            when={messages().length > 0}
            fallback={
              <div class="text-center text-neutral-500">
                {props.contact.type === "community"
                  ? t("communityChat.noMessages")
                  : t("dm.noMessages")}
              </div>
            }
          >
            <For each={messages()}>
              {(msg, index) => {
                const isMine = getSenderApId(msg) === props.actor.ap_id;
                const showAvatar =
                  !isMine &&
                  (index() === 0 ||
                    getSenderApId(messages()[index() - 1]) !==
                      getSenderApId(msg));

                return (
                  <div
                    class={`flex ${
                      isMine ? "justify-end" : "justify-start"
                    } mb-2`}
                  >
                    <Show
                      when={!isMine && showAvatar}
                      fallback={!isMine ? <div class="w-8 mr-2" /> : undefined}
                    >
                      <img
                        src={msg.sender.icon_url || ""}
                        alt={msg.sender.name || msg.sender.preferred_username}
                        class="w-8 h-8 rounded-full mr-2 object-cover"
                      />
                    </Show>
                    <div
                      class={`max-w-[70%] ${
                        isMine ? "text-right" : "text-left"
                      }`}
                    >
                      <Show when={!isMine && showAvatar}>
                        <div class="text-xs text-neutral-500 mb-1">
                          {msg.sender.name || msg.sender.preferred_username}
                        </div>
                      </Show>
                      <div
                        class={`inline-block px-4 py-2 rounded-2xl ${
                          isMine
                            ? "bg-blue-500 text-white rounded-br-sm"
                            : "bg-neutral-800 text-white rounded-bl-sm"
                        }`}
                      >
                        <p class="text-sm">{msg.content}</p>
                      </div>
                      <div class="text-xs text-neutral-500 mt-1">
                        {formatTime(msg.created_at)}
                      </div>
                    </div>
                  </div>
                );
              }}
            </For>
          </Show>
        </Show>
        <Show when={props.contact.type === "user" && isTyping()}>
          <div class="text-xs text-neutral-500 mt-2">{t("dm.typing")}</div>
        </Show>
        <Show when={errorMessage()}>
          <div class="mt-4 text-center text-red-400 text-sm">
            {errorMessage()}
          </div>
        </Show>
        <div ref={messagesEndRef!} />
      </div>

      <form onSubmit={handleSend} class="p-4 border-t border-neutral-900">
        <div class="flex gap-2">
          <input
            type="text"
            value={input()}
            onInput={handleInputChange}
            placeholder={t("dm.placeholder")}
            class="flex-1 px-4 py-2 bg-neutral-900 border border-neutral-800 rounded-full text-white placeholder-neutral-500 focus:outline-none focus:border-blue-500"
          />
          <button
            type="submit"
            disabled={!input().trim() || sending()}
            aria-label="Send message"
            class="px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-neutral-700 disabled:cursor-not-allowed text-white rounded-full font-medium transition-colors"
          >
            <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          </button>
        </div>
      </form>
    </div>
  );
}
