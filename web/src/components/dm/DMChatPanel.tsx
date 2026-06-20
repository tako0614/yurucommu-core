import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { A } from "@solidjs/router";
import { Actor, DMMessage } from "../../types/index.ts";
import {
  CommunityMessage,
  DMContact,
  fetchCommunityMessages,
  fetchUserDMMessages,
  fetchUserDMTyping,
  markCommunityAsRead,
  markDMAsRead,
  sendCommunityMessage,
  sendUserDMMessage,
  sendUserDMTyping,
} from "../../lib/api.ts";
import { formatTime } from "../../lib/datetime.ts";
import { useI18n } from "../../lib/i18n.tsx";
import { UserAvatar } from "../UserAvatar.tsx";

interface DMChatPanelProps {
  contact: DMContact;
  actor: Actor;
  onBack: () => void;
  onRead?: () => void;
}

type ChatMessage = DMMessage | CommunityMessage;

// Poll interval for re-fetching incoming messages on the open conversation.
const MESSAGE_POLL_MS = 4000;

/**
 * Merge a freshly-fetched message list into the existing list, deduplicating
 * by message id. The server-ordered `fetched` list is authoritative; any
 * existing message not yet present in it (e.g. an optimistic send the server
 * has not indexed yet) is appended at the end so it does not flicker out.
 */
function mergeMessagesById(
  existing: ChatMessage[],
  fetched: ChatMessage[],
): ChatMessage[] {
  const fetchedIds = new Set(fetched.map((m) => m.id));
  const pending = existing.filter((m) => !fetchedIds.has(m.id));
  const merged = pending.length > 0 ? [...fetched, ...pending] : fetched;

  // No-op guard: if the merged id-sequence is identical to the existing one,
  // return the PREVIOUS array reference so the `messages` signal does not
  // change identity on a poll that fetched nothing new. This stops the
  // scroll-to-bottom effect from re-firing every poll interval.
  if (merged.length === existing.length) {
    let same = true;
    for (let i = 0; i < merged.length; i++) {
      if (merged[i].id !== existing[i].id) {
        same = false;
        break;
      }
    }
    if (same) return existing;
  }
  return merged;
}

export function DMChatPanel(props: DMChatPanelProps) {
  const [messages, setMessages] = createSignal<ChatMessage[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [input, setInput] = createSignal("");
  const [sending, setSending] = createSignal(false);
  const [isTyping, setIsTyping] = createSignal(false);
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null);
  let messagesEndRef!: HTMLDivElement;
  let scrollContainerRef!: HTMLDivElement;
  let lastTypingSent = 0;
  // Scroll-tracking: remember the previous last-message id and count so the
  // auto-scroll effect only fires when the conversation actually grows, not on
  // every 4s poll (which would yank the user away from history they are reading).
  let prevLastId: string | null = null;
  let prevCount = 0;
  let didInitialScroll = false;
  const { t } = useI18n();

  // Fetch the latest messages for the open conversation. On `initial` load we
  // show the spinner and replace state; on poll refreshes we merge by id so
  // optimistic sends are not lost and there is no flicker.
  const refreshMessages = async (
    contactApId: string,
    contactType: DMContact["type"],
    mode: "initial" | "poll",
    isCancelled: () => boolean,
  ) => {
    if (mode === "initial") {
      setErrorMessage(null);
      setLoading(true);
    }
    try {
      if (contactType === "community") {
        const data = await fetchCommunityMessages(contactApId);
        if (isCancelled()) return;
        let changed = false;
        setMessages((prev) => {
          const next =
            mode === "initial" ? data : mergeMessagesById(prev, data);
          changed = next !== prev;
          return next;
        });
        // Only POST mark-as-read on the initial load or when genuinely new
        // content arrived; otherwise every poll triggers a redundant write.
        if (mode === "initial" || changed) {
          try {
            await markCommunityAsRead(contactApId);
            if (!isCancelled()) props.onRead?.();
          } catch {
            // Ignore read marking errors.
          }
        }
      } else {
        const { messages: loadedMessages } =
          await fetchUserDMMessages(contactApId);
        if (isCancelled()) return;
        let changed = false;
        setMessages((prev) => {
          const next =
            mode === "initial"
              ? loadedMessages
              : mergeMessagesById(prev, loadedMessages);
          changed = next !== prev;
          return next;
        });
        if (mode === "initial" || changed) {
          try {
            await markDMAsRead(contactApId);
            if (!isCancelled()) props.onRead?.();
          } catch {
            // Ignore read marking errors.
          }
        }
      }
    } catch (e) {
      if (!isCancelled() && mode === "initial") {
        console.error("Failed to load messages:", e);
        setErrorMessage(t("common.error"));
      }
      // Poll failures are transient; keep the last good state silently.
    } finally {
      if (!isCancelled() && mode === "initial") {
        setLoading(false);
      }
    }
  };

  createEffect(() => {
    const contactApId = props.contact.ap_id;
    const contactType = props.contact.type;
    let cancelled = false;
    const isCancelled = () => cancelled;

    // Reset scroll tracking so the new conversation jumps to its bottom once.
    prevLastId = null;
    prevCount = 0;
    didInitialScroll = false;

    void refreshMessages(contactApId, contactType, "initial", isCancelled);

    // Re-fetch incoming messages while the conversation is open so messages
    // sent by the other side appear without leaving and re-entering the thread.
    const intervalId = window.setInterval(() => {
      void refreshMessages(contactApId, contactType, "poll", isCancelled);
    }, MESSAGE_POLL_MS);

    onCleanup(() => {
      cancelled = true;
      window.clearInterval(intervalId);
    });
  });

  createEffect(() => {
    const list = messages();
    const lastId = list.length > 0 ? list[list.length - 1].id : null;
    const grewOrChanged = lastId !== prevLastId || list.length !== prevCount;

    // On the very first non-empty render, jump to the bottom regardless of
    // position. After that, only auto-scroll when the conversation actually
    // changed (new/optimistic message) AND the user is already near the bottom,
    // so reading back through history is not interrupted by a poll.
    if (!grewOrChanged) {
      return;
    }

    const isInitial = !didInitialScroll && list.length > 0;
    const el = scrollContainerRef;
    const nearBottom =
      !el || el.scrollHeight - el.scrollTop - el.clientHeight < 120;

    prevLastId = lastId;
    prevCount = list.length;

    if (isInitial) {
      didInitialScroll = true;
      messagesEndRef?.scrollIntoView();
    } else if (nearBottom) {
      messagesEndRef?.scrollIntoView({ behavior: "smooth" });
    }
  });

  createEffect(() => {
    const contactApId = props.contact.ap_id;
    const contactType = props.contact.type;

    if (contactType !== "user" || isRemoteContact(contactApId)) {
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
        // Dedupe by id: a concurrent poll may have already merged this message.
        setMessages((prev) =>
          prev.some((m) => m.id === newMsg.id) ? prev : [...prev, newMsg],
        );
      } else {
        const { message } = await sendUserDMMessage(
          props.contact.ap_id,
          input().trim(),
        );
        setMessages((prev) =>
          prev.some((m) => m.id === message.id) ? prev : [...prev, message],
        );
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

  // A contact is remote when its AP-ID host differs from this instance's host.
  // Typing indicators are local-only (no federation delivery), so polling a
  // remote peer's typing state can never return true and is a dead 4s request.
  const isRemoteContact = (apId: string): boolean => {
    try {
      return new URL(apId).host !== window.location.host;
    } catch {
      return false;
    }
  };

  return (
    <div class="flex flex-col h-full">
      <div class="flex items-center gap-3 px-4 py-3 border-b border-neutral-900 bg-neutral-900/80 backdrop-blur-sm">
        <button
          onClick={props.onBack}
          aria-label={t("common.back")}
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

      <div ref={scrollContainerRef!} class="flex-1 overflow-y-auto px-4 py-4">
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
                      <UserAvatar
                        avatarUrl={msg.sender.icon_url || null}
                        name={
                          msg.sender.name ||
                          msg.sender.preferred_username ||
                          "?"
                        }
                        size={32}
                        class="mr-2"
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
                            ? "bg-accent text-white rounded-br-sm"
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
            class="flex-1 px-4 py-2 bg-neutral-900 border border-neutral-800 rounded-full text-white placeholder-neutral-500 focus:outline-none focus:border-accent"
          />
          <button
            type="submit"
            disabled={!input().trim() || sending()}
            aria-label="Send message"
            class="px-4 py-2 bg-accent disabled:bg-neutral-700 disabled:cursor-not-allowed text-white rounded-full font-medium transition-colors"
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
