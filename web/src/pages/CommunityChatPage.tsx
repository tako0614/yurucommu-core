import { createEffect, For, onCleanup, onMount, Show } from "solid-js";
import { A, useNavigate, useParams } from "@solidjs/router";
import { atom } from "jotai";
import { useAtom } from "solid-jotai";
import { useRequiredActor } from "../hooks/useRequiredActor.ts";
import {
  CommunityDetail,
  CommunityMember,
  CommunityMessage,
  fetchCommunity,
  fetchCommunityMembers,
  fetchCommunityMessages,
  leaveCommunity,
  sendCommunityMessage,
} from "../lib/api.ts";
import { useI18n } from "../lib/i18n.tsx";
import { formatChatDateHeader, formatTime } from "../lib/datetime.ts";
import { UserAvatar } from "../components/UserAvatar.tsx";

const BackIcon = () => (
  <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width={2}
      d="M15 19l-7-7 7-7"
    />
  </svg>
);

const SendIcon = () => (
  <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width={2}
      d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
    />
  </svg>
);

const UsersIcon = () => (
  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width={2}
      d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
    />
  </svg>
);

const CloseIcon = () => (
  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width={2}
      d="M6 18L18 6M6 6l12 12"
    />
  </svg>
);

function MembersModal(props: {
  community: CommunityDetail;
  members: CommunityMember[];
  onClose: () => void;
}) {
  return (
    <div class="fixed inset-0 bg-neutral-900/80 z-50 flex items-center justify-center p-4">
      <div class="bg-neutral-900 rounded-xl w-full max-w-md max-h-[80vh] flex flex-col">
        <div class="flex items-center justify-between p-4 border-b border-neutral-800">
          <h2 class="text-lg font-bold text-white">
            メンバー ({props.members.length})
          </h2>
          <button
            onClick={props.onClose}
            aria-label="Close"
            class="text-neutral-400 hover:text-white"
          >
            <CloseIcon />
          </button>
        </div>

        <div class="flex-1 overflow-y-auto">
          <For each={props.members}>
            {(member) => (
              <A
                href={`/profile/${encodeURIComponent(member.ap_id)}`}
                class="flex items-center gap-3 px-4 py-3 hover:bg-neutral-800 transition-colors"
                onClick={props.onClose}
              >
                <UserAvatar
                  avatarUrl={member.icon_url}
                  name={member.name || member.preferred_username}
                  size={44}
                />
                <div class="flex-1 min-w-0">
                  <div class="font-medium text-white truncate">
                    {member.name || member.preferred_username}
                  </div>
                  <div class="text-sm text-neutral-500 truncate">
                    @{member.username}
                  </div>
                </div>
                <Show when={member.role === "owner"}>
                  <span class="px-2 py-0.5 text-xs bg-yellow-500/20 text-yellow-400 rounded">
                    オーナー
                  </span>
                </Show>
                <Show when={member.role === "moderator"}>
                  <span class="px-2 py-0.5 text-xs bg-blue-500/20 text-blue-400 rounded">
                    モデレーター
                  </span>
                </Show>
              </A>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}

// Atoms defined at module level
const communityChat_communityAtom = atom<CommunityDetail | null>(null);
const communityChat_messagesAtom = atom<CommunityMessage[]>([]);
const communityChat_membersAtom = atom<CommunityMember[]>([]);
const communityChat_loadingAtom = atom(true);
const communityChat_inputValueAtom = atom("");
const communityChat_sendingAtom = atom(false);
const communityChat_showMembersAtom = atom(false);
const communityChat_errorMessageAtom = atom<string | null>(null);

export function CommunityChatPage() {
  const actor = useRequiredActor();
  const params = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();

  const [community, setCommunity] = useAtom(communityChat_communityAtom);
  const [messages, setMessages] = useAtom(communityChat_messagesAtom);
  const [members, setMembers] = useAtom(communityChat_membersAtom);
  const [loading, setLoading] = useAtom(communityChat_loadingAtom);
  const [inputValue, setInputValue] = useAtom(communityChat_inputValueAtom);
  const [sending, setSending] = useAtom(communityChat_sendingAtom);
  const [showMembers, setShowMembers] = useAtom(communityChat_showMembersAtom);
  const [errorMessage, setErrorMessage] = useAtom(
    communityChat_errorMessageAtom,
  );

  let messagesEndRef!: HTMLDivElement;
  let inputRef!: HTMLTextAreaElement;

  const scrollToBottom = () => {
    messagesEndRef?.scrollIntoView({ behavior: "smooth" });
  };

  createEffect(() => {
    const name = params.name;
    if (!name) return;
    setCommunity(null);
    setMessages([]);
    setMembers([]);
    setInputValue("");
    setErrorMessage(null);
    setShowMembers(false);
    setLoading(true);
    loadData();
  });

  createEffect(() => {
    // Scroll to bottom when messages change
    const _msgs = messages();
    scrollToBottom();
  });

  const loadData = async () => {
    const name = params.name;
    if (!name) return;
    // Only show loading if no cached data
    if (!community()) setLoading(true);
    setErrorMessage(null);
    try {
      const [communityData, messagesData, membersData] = await Promise.all([
        fetchCommunity(name),
        fetchCommunityMessages(name),
        fetchCommunityMembers(name),
      ]);
      setCommunity(communityData);
      setMessages(messagesData);
      setMembers(membersData);
    } catch (e) {
      console.error("Failed to load community:", e);
      setErrorMessage(t("common.error"));
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async () => {
    const name = params.name;
    if (!inputValue().trim() || !name || sending()) return;

    const content = inputValue().trim();
    setInputValue("");
    setSending(true);
    setErrorMessage(null);

    try {
      const message = await sendCommunityMessage(name, content);
      setMessages((prev) => [...prev, message]);
    } catch (e) {
      console.error("Failed to send message:", e);
      setInputValue(content);
      setErrorMessage(t("common.error"));
    } finally {
      setSending(false);
      inputRef?.focus();
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleLeave = async () => {
    const name = params.name;
    const comm = community();
    if (!name || !comm) return;
    if (!confirm(t("communityChat.leaveConfirm"))) return;

    try {
      await leaveCommunity(name);
      navigate("/groups");
    } catch (e) {
      console.error("Failed to leave:", e);
      setErrorMessage(t("common.error"));
    }
  };

  // Group messages by date
  const groupedMessages = (): {
    date: string;
    messages: CommunityMessage[];
  }[] => {
    const groups: { date: string; messages: CommunityMessage[] }[] = [];
    let currentDate = "";
    for (const msg of messages()) {
      const msgDate = new Date(msg.created_at).toDateString();
      if (msgDate !== currentDate) {
        currentDate = msgDate;
        groups.push({ date: msg.created_at, messages: [msg] });
      } else {
        groups[groups.length - 1].messages.push(msg);
      }
    }
    return groups;
  };

  return (
    <Show
      when={!loading()}
      fallback={
        <div class="flex items-center justify-center h-full bg-neutral-900">
          <div class="text-neutral-500">{t("messages.loading")}</div>
        </div>
      }
    >
      <Show
        when={community()}
        fallback={
          <div class="flex flex-col items-center justify-center h-full bg-neutral-900">
            <div class="text-neutral-500 mb-4">
              {t("communityChat.notFound")}
            </div>
            <button
              onClick={() => navigate("/groups")}
              class="px-4 py-2 bg-neutral-800 text-white rounded-lg hover:bg-neutral-700 transition-colors"
            >
              {t("communityChat.backToList")}
            </button>
          </div>
        }
      >
        <Show
          when={community()!.is_member}
          fallback={
            <div class="flex flex-col items-center justify-center h-full bg-neutral-900">
              <div class="text-neutral-500 mb-4">
                {t("communityChat.notMember")}
              </div>
              <button
                onClick={() => navigate("/groups")}
                class="px-4 py-2 bg-neutral-800 text-white rounded-lg hover:bg-neutral-700 transition-colors"
              >
                {t("communityChat.backToList")}
              </button>
            </div>
          }
        >
          <div class="flex flex-col h-full bg-neutral-900">
            {/* Header */}
            <header class="sticky top-0 bg-neutral-900/90 backdrop-blur-sm z-10 border-b border-neutral-900">
              <div class="flex items-center gap-3 px-2 py-2">
                <button
                  onClick={() => navigate("/groups")}
                  aria-label="Back"
                  class="p-2 text-neutral-400 hover:text-white transition-colors"
                >
                  <BackIcon />
                </button>

                <div class="w-10 h-10 rounded-full bg-neutral-800 flex items-center justify-center overflow-hidden">
                  <Show
                    when={community()!.icon_url}
                    fallback={
                      <span class="text-lg font-medium text-white">
                        {(community()!.display_name || community()!.name)
                          .charAt(0).toUpperCase()}
                      </span>
                    }
                  >
                    <img
                      src={community()!.icon_url ?? undefined}
                      alt=""
                      class="w-full h-full object-cover"
                    />
                  </Show>
                </div>

                <div class="flex-1 min-w-0">
                  <div class="font-semibold text-white truncate">
                    {community()!.display_name || community()!.name}
                  </div>
                  <div class="text-xs text-neutral-500">
                    {community()!.member_count}人
                  </div>
                </div>

                <button
                  onClick={() => setShowMembers(true)}
                  aria-label="View members"
                  class="p-2 text-neutral-400 hover:text-white transition-colors"
                >
                  <UsersIcon />
                </button>
              </div>
            </header>

            {/* Messages */}
            <div class="flex-1 overflow-y-auto px-4 py-4">
              <Show when={errorMessage()}>
                <div class="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
                  {errorMessage()}
                </div>
              </Show>
              <Show
                when={messages().length > 0}
                fallback={
                  <div class="text-center text-neutral-500 py-8">
                    <p>{t("communityChat.noMessages")}</p>
                    <p class="text-sm mt-2">
                      {t("communityChat.noMessagesHint")}
                    </p>
                  </div>
                }
              >
                <For each={groupedMessages()}>
                  {(group, groupIndex) => (
                    <div>
                      {/* Date header */}
                      <div class="flex justify-center my-4">
                        <span class="px-3 py-1 text-xs text-neutral-500 bg-neutral-900 rounded-full">
                          {formatChatDateHeader(group.date)}
                        </span>
                      </div>

                      {/* Messages for this date */}
                      <For each={group.messages}>
                        {(msg, msgIndex) => {
                          const isMe = msg.sender.ap_id === actor.ap_id;
                          const showAvatar = msgIndex() === 0 ||
                            group.messages[msgIndex() - 1].sender.ap_id !==
                              msg.sender.ap_id;

                          return (
                            <div
                              class={`flex gap-2 mb-1 ${
                                isMe ? "flex-row-reverse" : ""
                              }`}
                            >
                              <Show when={!isMe}>
                                <div class="w-8 flex-shrink-0">
                                  <Show when={showAvatar}>
                                    <A
                                      href={`/profile/${
                                        encodeURIComponent(msg.sender.ap_id)
                                      }`}
                                    >
                                      <UserAvatar
                                        avatarUrl={msg.sender.icon_url}
                                        name={msg.sender.name ||
                                          msg.sender.preferred_username}
                                        size={32}
                                      />
                                    </A>
                                  </Show>
                                </div>
                              </Show>

                              <div
                                class={`flex flex-col ${
                                  isMe ? "items-end" : "items-start"
                                } max-w-[70%]`}
                              >
                                <Show when={showAvatar && !isMe}>
                                  <span class="text-xs text-neutral-500 mb-1 ml-1">
                                    {msg.sender.name ||
                                      msg.sender.preferred_username}
                                  </span>
                                </Show>
                                <div class="flex items-end gap-2">
                                  <Show when={isMe}>
                                    <span class="text-xs text-neutral-600">
                                      {formatTime(msg.created_at)}
                                    </span>
                                  </Show>
                                  <div
                                    class={`px-3 py-2 rounded-2xl break-words ${
                                      isMe
                                        ? "bg-blue-500 text-white rounded-br-sm"
                                        : "bg-neutral-800 text-white rounded-bl-sm"
                                    }`}
                                  >
                                    {msg.content}
                                  </div>
                                  <Show when={!isMe}>
                                    <span class="text-xs text-neutral-600">
                                      {formatTime(msg.created_at)}
                                    </span>
                                  </Show>
                                </div>
                              </div>
                            </div>
                          );
                        }}
                      </For>
                    </div>
                  )}
                </For>
              </Show>
              <div ref={messagesEndRef!} />
            </div>

            {/* Input */}
            <div class="sticky bottom-0 bg-neutral-900 border-t border-neutral-900 px-4 py-3">
              <div class="flex items-end gap-2">
                <textarea
                  ref={inputRef!}
                  value={inputValue()}
                  onInput={(e) => setInputValue(e.currentTarget.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={t("messages.placeholder")}
                  rows={1}
                  class="flex-1 bg-neutral-800 text-white rounded-2xl px-4 py-2 outline-none resize-none max-h-32 focus:ring-2 focus:ring-blue-500"
                  style={{ "min-height": "40px" }}
                />
                <button
                  onClick={handleSend}
                  disabled={!inputValue().trim() || sending()}
                  aria-label="Send message"
                  class="p-2 bg-blue-500 text-white rounded-full hover:bg-blue-600 transition-colors disabled:opacity-50"
                >
                  <SendIcon />
                </button>
              </div>

              {/* Leave button */}
              <button
                onClick={handleLeave}
                class="mt-3 w-full text-center text-sm text-red-400 hover:text-red-300 transition-colors"
              >
                {t("communityChat.leave")}
              </button>
            </div>

            {/* Members Modal */}
            <Show when={showMembers()}>
              <MembersModal
                community={community()!}
                members={members()}
                onClose={() => setShowMembers(false)}
              />
            </Show>
          </div>
        </Show>
      </Show>
    </Show>
  );
}

export default CommunityChatPage;
