import { A, useNavigate, useMatch } from "@solidjs/router";
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  Show,
  untrack,
} from "solid-js";
import { createStore } from "solid-js/store";
import {
  IconMessage,
  IconMessagePlus,
  IconSettings,
} from "../components/icons";
import {
  fetchDirectMessages,
  fetchChannelMessages,
  postDirectMessage,
  postChannelMessage,
  listMyFriends,
  useMe,
  api,
  getBackendUrl,
} from "../lib/api";
import {
  createChannel as apiCreateChannel,
  deleteChannel as apiDeleteChannel,
  listChannels as apiListChannels,
  updateChannel as apiUpdateChannel,
} from "../lib/channels";
import Avatar from "../components/Avatar";
import useSwipeTabs from "../hooks/useSwipeTabs";

type Community = { id: string; name?: string; icon_url?: string };
type Channel = { id: string; name: string };
type Selection =
  | { kind: "dm"; id: string }
  | { kind: "channel"; communityId: string; channelId: string };
type MessageObject = {
  id: string;
  type: "DirectMessage" | "ChannelMessage";
  content?: string;
  published?: string;
  actor?: string;
  inReplyTo?: string | null;
};

const [messagesByConversation, setMessagesByConversation] = createStore<Record<string, MessageObject[]>>({});
const [loadingConvo, setLoadingConvo] = createStore<Record<string, boolean>>({});
const [errorConvo, setErrorConvo] = createStore<Record<string, string>>({});

function resolveInstanceOrigin(): string {
  const backendOrigin = getBackendUrl();
  if (backendOrigin) {
    return backendOrigin;
  }
  if (typeof window !== "undefined" && window.location.origin) {
    return window.location.origin;
  }
  throw new Error("Backend origin not configured");
}

function buildActorUri(origin: string, handle: string): string {
  const base = origin.replace(/\/+$/, "");
  return `${base}/ap/users/${encodeURIComponent(handle)}`;
}

function computeThreadId(origin: string, localHandle: string, otherHandle: string): string {
  const participants = [
    buildActorUri(origin, localHandle),
    buildActorUri(origin, otherHandle),
  ]
    .map((uri) => uri.trim())
    .filter(Boolean)
    .sort();
  return participants.join("#");
}

function keyOf(selection: Selection): string {
  return selection.kind === "dm"
    ? `dm:${selection.id}`
    : `channel:${selection.communityId}#${selection.channelId}`;
}

function mapCollection(collection: any): MessageObject[] {
  const items = collection?.orderedItems || [];
  return items.map((item: any) => ({
    id: item?.id || crypto.randomUUID(),
    type: item?.type || "DirectMessage",
    content: item?.content || "",
    published: item?.published,
    actor: item?.actor,
    inReplyTo: item?.inReplyTo ?? null,
  }));
}

async function loadDm(threadId: string, conversationId?: string) {
  const key = `dm:${conversationId || threadId}`;
  const isLoading = untrack(() => loadingConvo[key]);
  if (isLoading) return;
  setLoadingConvo(key, true);
  setErrorConvo(key, "");
  try {
    const data = await fetchDirectMessages(threadId);
    setMessagesByConversation(key, mapCollection(data));
  } catch (err: any) {
    setErrorConvo(key, err?.message || "DMの読み込みに失敗しました");
  } finally {
    setLoadingConvo(key, false);
  }
}

async function loadChannel(communityId: string, channelId: string, channelName?: string) {
  const key = `channel:${communityId}#${channelId}`;
  const isLoading = untrack(() => loadingConvo[key]);
  if (isLoading) return;
  setLoadingConvo(key, true);
  setErrorConvo(key, "");
  try {
    const channelParam = channelName || channelId;
    const data = await fetchChannelMessages(communityId, channelParam);
    setMessagesByConversation(key, mapCollection(data));
  } catch (err: any) {
    setErrorConvo(key, err?.message || "メッセージの読み込みに失敗しました");
  } finally {
    setLoadingConvo(key, false);
  }
}

async function sendDm(
  selection: { kind: "dm"; id: string },
  text: string,
  localHandle?: string,
) {
  if (!localHandle) {
    throw new Error("sender handle is required");
  }
  const instanceOrigin = resolveInstanceOrigin();
  // Send recipient handle, not the full URI
  await postDirectMessage({
    recipients: [selection.id],
    content: text,
  });
  // Reload the conversation using the thread ID from response
  await loadDm(computeThreadId(instanceOrigin, localHandle, selection.id), selection.id);
}

async function sendChannel(
  selection: { kind: "channel"; communityId: string; channelId: string },
  text: string,
  channelName?: string,
) {
  await postChannelMessage({
    communityId: selection.communityId,
    channelId: selection.channelId,
    content: text,
  });
  await loadChannel(selection.communityId, selection.channelId, channelName || selection.channelId);
}

function MessageBubble(props: { msg: MessageObject; mine: boolean }) {
  const { msg, mine } = props;
  return (
    <div class={`flex items-end gap-2 ${mine ? "justify-end" : "justify-start"}`}>
      {mine && (
        <div class="text-[10px] opacity-70 text-right self-end">
          {msg.published ? new Date(msg.published).toLocaleTimeString() : ""}
        </div>
      )}
      <div
        class={`w-fit max-w-[80%] rounded-2xl px-3 py-2 text-sm ${mine ? "bg-gray-900 text-white" : "bg-gray-100 dark:bg-neutral-800"}`}
      >
        <div class="whitespace-pre-wrap">{msg.content || ""}</div>
      </div>
      {!mine && (
        <div class="text-[10px] opacity-70 text-right self-end">
          {msg.published ? new Date(msg.published).toLocaleTimeString() : ""}
        </div>
      )}
    </div>
  );
}

function ChatWindow(props: {
  selection: Selection | null;
  title: string;
  localHandle: string | undefined;
  channelName?: string;
  onBack?: () => void;
  onOpenSettings?: () => void;
}) {
  const [input, setInput] = createSignal("");
  const key = () => (props.selection ? keyOf(props.selection) : "");
  const messages = createMemo(() => messagesByConversation[key()] || []);
  const loading = () => loadingConvo[key()];
  const error = () => errorConvo[key()];

  createEffect(() => {
    const sel = props.selection;
    const handle = props.localHandle;
    if (!sel || !handle) return;
    if (sel.kind === "dm") {
      const threadId = computeThreadId(resolveInstanceOrigin(), handle, sel.id);
      loadDm(threadId, sel.id);
    } else {
      loadChannel(sel.communityId, sel.channelId, props.channelName);
    }
  });

  const send = async (e: Event) => {
    e.preventDefault();
    const sel = props.selection;
    const handle = props.localHandle;
    const text = input().trim();
    if (!sel || !handle || !text) return;
    setInput("");
    try {
      if (sel.kind === "dm") {
        await sendDm(sel, text, handle);
      } else {
        await sendChannel(sel, text, props.channelName);
      }
    } catch (err: any) {
      alert(err?.message || "送信に失敗しました");
    }
  };

  return (
    <div class="flex flex-col h-full min-h-[360px]">
      <div class="border-b hairline px-2 md:px-4 py-3 font-semibold sticky top-0 bg-white dark:bg-neutral-900 backdrop-blur-md flex items-center gap-2">
        <button class="md:hidden px-2 py-1 -ml-1 rounded hover:bg-gray-100 active:opacity-80" onClick={() => props.onBack?.()}>
          <span class="text-xl leading-none">&lt;</span>
        </button>
        <div class="flex-1 truncate px-1">{props.title}</div>
        <button class="md:hidden px-2 py-1 rounded hover:bg-gray-100 active:opacity-80" onClick={() => props.onOpenSettings?.()} aria-label="設定を開く">
          <span class="block w-5 h-[2px] bg-current mb-[4px]"></span>
          <span class="block w-5 h-[2px] bg-current mb-[4px]"></span>
          <span class="block w-5 h-[2px] bg-current"></span>
        </button>
      </div>
      <div class="flex-1 overflow-y-auto bg-white dark:bg-neutral-900">
        <div class="p-3 space-y-2">
          <Show when={!loading()} fallback={<div class="text-sm text-muted">読み込み中...</div>}>
            <For each={messages()}>
              {(msg) => (
                <MessageBubble msg={msg} mine={msg.actor?.includes(props.localHandle || "") ?? false} />
              )}
            </For>
            <Show when={messages().length === 0 && !error()}>
              <div class="text-sm text-muted">メッセージはまだありません</div>
            </Show>
            <Show when={error()}>
              <div class="text-sm text-red-500">{error()}</div>
            </Show>
          </Show>
        </div>
      </div>
      <form class="border-t hairline px-3 py-2 flex gap-2 items-center" onSubmit={send}>
        <input
          value={input()}
          onInput={(e) => setInput(e.currentTarget.value)}
          class="flex-1 rounded-full px-4 py-2 bg-white dark:bg-neutral-900 border hairline"
          placeholder="メッセージを入力"
        />
        <button type="submit" class="w-10 h-10 rounded-full bg-gray-900 text-white flex items-center justify-center" aria-label="送信">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 2L11 13" />
            <path d="M22 2l-7 20 1-7 7-13z" />
          </svg>
        </button>
      </form>
    </div>
  );
}

export default function Chat() {
  const navigate = useNavigate();

  const me = useMe();

  const [friends] = createResource(async () =>
    (await listMyFriends().catch(() => [])) as any[]
  );
  const [comms] = createResource<Community[]>(async () =>
    (await api("/me/communities").catch(() => [])) as Community[]
  );

  // Channels fetched from backend per community (lazy-load on expand)
  const [channelsByCommunity, setChannelsByCommunity] = createStore<
    Record<string, Channel[]>
  >({});
  const [channelsLoading, setChannelsLoading] = createStore<
    Record<string, boolean>
  >({});
  const [channelsError, setChannelsError] = createStore<Record<string, string>>(
    {},
  );

  async function ensureChannelsLoaded(communityId: string) {
    if (
      channelsByCommunity[communityId] &&
      channelsByCommunity[communityId].length
    ) return;
    if (channelsLoading[communityId]) return;
    setChannelsError(communityId, "");
    setChannelsLoading(communityId, true);
    try {
      const chs = await apiListChannels(communityId);
      setChannelsByCommunity(
        communityId,
        chs.map((ch) => ({ id: ch.id, name: ch.name })),
      );
    } catch (e: any) {
      setChannelsError(communityId, e?.message || "チャンネルを読み込めませんでした");
    } finally {
      setChannelsLoading(communityId, false);
    }
  }

  const [selection, setSelection] = createSignal<Selection | null>(null);
  // expanded state per community id for showing channels in list
  const [expandedComms, setExpandedComms] = createStore<
    Record<string, boolean>
  >({});
  const [mobileSettingsOpen, setMobileSettingsOpen] = createSignal(false);
  const [leftTab, setLeftTab] = createSignal<"friends" | "community">(
    "friends",
  );

  // useSwipeTabs hook handles swipe state/logic for the left list (friends/community)
  const swipe = useSwipeTabs({
    length: 2,
    currentIndex: () => (leftTab() === "friends" ? 0 : 1),
    setIndex: (i) => setLeftTab(i === 0 ? "friends" : "community"),
  });

  // helper: latest message preview for a conversation key
  const latestPreview = (key: string) => {
    const msgs = messagesByConversation[key] || [];
    if (!msgs || msgs.length === 0) return "";
    const last = msgs[msgs.length - 1];
    const content = last.content || "";
    return content.length > 40 ? content.slice(0, 40) + "…" : content;
  };

  // reflect URL -> selection using router-aware matchers
  const matchDm = useMatch(() => "/chat/dm/:id");
  const matchChannel = useMatch(() => "/chat/c/:communityId/:channelId?");

  createEffect(() => {
    const dmParams = matchDm();
    if (dmParams) {
      setSelection({ kind: "dm", id: decodeURIComponent(dmParams.params.id) });
      return;
    }
    const channelParams = matchChannel();
    if (channelParams) {
      const { communityId, channelId } = channelParams.params;
      const decodedCommunityId = decodeURIComponent(communityId);

      // If no channelId in URL, use the first available channel for this community
      let finalChannelId: string;
      if (channelId) {
        finalChannelId = decodeURIComponent(channelId);
      } else {
        const channels = channelsByCommunity[decodedCommunityId];
        finalChannelId = channels?.[0]?.id ?? "general";
      }

      setSelection({
        kind: "channel",
        communityId: decodedCommunityId,
        channelId: finalChannelId,
      });
      return;
    }
    setSelection(null);
  });

  const friendEntries = createMemo(() => {
    const meId = me()?.id;
    return (friends() || [])
      .map((edge: any) => {
        const user = edge.requester_id === meId ? edge.addressee : edge.requester;
        return user?.id ? { user, edge } : null;
      })
      .filter(Boolean) as Array<{ user: any; edge: any }>;
  });

  const selTitle = createMemo(() => {
    const s = selection();
    if (!s) return "";
    if (s.kind === "dm") {
      const dm = friendEntries()
        .map((entry) => entry.user)
        .find((user: any) => user?.id === s.id);
      return dm?.display_name || `DM ${s.id}`;
    }
    const c = (comms() || []).find((x) => x.id === s.communityId);
    const ch = (channelsByCommunity[s.communityId] || []).find((x) =>
      x.id === s.channelId
    );
    return `${c?.name || s.communityId} ／ #${ch?.name || s.channelId}`;
  });

  const selectedChannel = createMemo(() => {
    const s = selection();
    if (!s || s.kind !== "channel") return null;
    return (channelsByCommunity[s.communityId] || []).find(
      (x) => x.id === s.channelId,
    ) || null;
  });

  const addChannel = async (communityId: string) => {
    const name = prompt("新しいチャンネル名を入力してください")?.trim();
    if (!name) return;
    try {
      const ch = await apiCreateChannel(communityId, name);
      setChannelsByCommunity(
        communityId,
        (arr = []) => [...arr, { id: ch.id, name: ch.name }],
      );
    } catch (_) {
      alert("チャンネル作成に失敗しました");
    }
  };

  const editChannel = async (
    communityId: string,
    channelId: string,
    currentName: string,
  ) => {
    const name = prompt("新しいチャンネル名を入力してください", currentName)?.trim();
    if (!name || name === currentName) return;
    try {
      await apiUpdateChannel(communityId, channelId, name);
      setChannelsByCommunity(
        communityId,
        (ch) => ch.id === channelId,
        "name",
        name,
      );
    } catch (_) {
      alert("チャンネル名の変更に失敗しました");
    }
  };

  const removeChannel = async (communityId: string, channelId: string) => {
    if (!confirm("本当にこのチャンネルを削除しますか？")) return;
    try {
      await apiDeleteChannel(communityId, channelId);
      setChannelsByCommunity(communityId, (arr) =>
        arr.filter((ch) => ch.id !== channelId),
      );
    } catch (_) {
      alert("チャンネルの削除に失敗しました");
    }
  };

  const showFeatureNotReady = () => {
    alert("この機能はまだ実装されていません。");
  };

  // type guards for Selection
  const dmActive = (dmId: string) => {
    const s = selection();
    return !!s && s.kind === "dm" && s.id === dmId;
  };
  const chActive = (cid: string, chid: string) => {
    const s = selection();
    return !!s && s.kind === "channel" && s.communityId === cid &&
      s.channelId === chid;
  };

  const isChannelSelection = (
    s: Selection | null,
  ): s is { kind: "channel"; communityId: string; channelId: string } => {
    return !!s && s.kind === "channel";
  };

  const selectedCommunityActive = (cid: string) => {
    const s = selection();
    return isChannelSelection(s) && s.communityId === cid;
  };
  // auto-expand currently selected community
  createEffect(() => {
    const s = selection();
    if (s && s.kind === "channel") setExpandedComms(s.communityId, true);
  });

  return (
    <div class="relative h-[calc(100dvh-48px)] md:h-[calc(100dvh-0px)] grid grid-cols-1 md:grid-cols-[280px_1fr_320px]">
      {/* Left: list */}
      <aside class="hidden md:flex flex-col border-r hairline">
        <div class="px-3 py-3 font-semibold flex items-center gap-2">
          メッセージ
          <button
            type="button"
            class="ml-auto inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-gray-100 active:opacity-80"
            onClick={showFeatureNotReady}
            aria-label="新しいメッセージを作成"
          >
            <IconMessagePlus size={18} />
          </button>
        </div>
        <div class="px-3 pb-2">
          <input
            class="w-full bg-white dark:bg-neutral-900 border hairline rounded-lg px-3 py-2 text-sm"
            placeholder="検索"
          />
        </div>

        {/* tab control */}
        <div class="px-3">
          <div class="flex rounded-full bg-gray-100 dark:bg-neutral-800 p-1 gap-1 w-full">
            <button
              class={`flex-1 text-sm px-3 py-1 rounded-full ${
                leftTab() === "friends"
                  ? "bg-white dark:bg-neutral-900 font-medium"
                  : ""
              }`}
              onClick={() => setLeftTab("friends")}
            >
              友達
            </button>
            <button
              class={`flex-1 text-sm px-3 py-1 rounded-full ${
                leftTab() === "community"
                  ? "bg-white dark:bg-neutral-900 font-medium"
                  : ""
              }`}
              onClick={() => setLeftTab("community")}
            >
              コミュニティ
            </button>
          </div>
        </div>

        <div
          class="overflow-hidden p-2"
          ref={swipe.ref}
          {...swipe.handlers}
        >
          <div
            class="flex"
            classList={{
              "transition-transform": !swipe.dragging(),
              "duration-300": !swipe.dragging(),
              "transition-none": swipe.dragging(),
            }}
            style={{
              width: `${2 * 100}%`,
              transform: swipe.sliderTransform(),
            }}
          >
            {/* Friends panel */}
            <div class="flex-none pr-2" style={{ width: "50%" }}>
              <div class="space-y-4">
                <div>
                  <div class="px-2 text-xs uppercase tracking-wide text-muted mb-1">
                    友達
                  </div>
                  <div class="flex flex-col gap-1">
                    <For each={friendEntries() || []}>
                      {({ user: dm, edge }) => {
                        const k = `dm:${dm.id}`;
                        return (
                          <A
                            href={`/chat/dm/${encodeURIComponent(dm.id)}`}
                            class={`px-2 py-2 rounded-lg hover:bg-gray-100 active:opacity-80 ${
                              dmActive(dm.id) ? "bg-gray-100" : ""
                            }`}
                            onClick={(e) => {
                              // set selection immediately to avoid list DOM being reset before UI updates
                              e.preventDefault();
                              setSelection({ kind: "dm", id: dm.id });
                              navigate(`/chat/dm/${encodeURIComponent(dm.id)}`);
                            }}
                          >
                            <div class="flex items-center gap-3">
                              <Avatar
                                src={dm.avatar_url || ""}
                                alt="アバター"
                                class="w-9 h-9 rounded-full"
                              />
                              <div class="flex-1 min-w-0">
                                <div class="text-sm font-medium truncate">
                                  {dm.display_name || dm.id}
                                </div>
                                <div class="text-[12px] text-muted truncate">
                                  {latestPreview(k) || (edge.status || "active")}
                                </div>
                              </div>
                            </div>
                          </A>
                        );
                      }}
                    </For>
                    <Show when={(friendEntries() || []).length === 0}>
                      <div class="px-3 py-6 text-xs text-muted">
                        友達がいません
                      </div>
                    </Show>
                  </div>
                </div>
              </div>
            </div>

            {/* Community panel */}
            <div class="flex-none pl-2" style={{ width: "50%" }}>
              <div class="space-y-2">
                <div class="px-2 text-xs uppercase tracking-wide text-muted mb-1">
                  コミュニティ
                </div>
                <div class="flex flex-col gap-2">
                  <For each={comms() || []}>
                    {(c) => {
                      const k = `c:${c.id}#general`;
                      const expanded = () => !!expandedComms[c.id];
                      return (
                        <div
                          class={`border hairline rounded-lg overflow-hidden ${
                            selectedCommunityActive(c.id)
                              ? "bg-gray-50 dark:bg-neutral-800/50"
                              : ""
                          }`}
                        >
                          {/* community header */}
                          <button
                            type="button"
                            class="w-full px-3 py-2 flex items-center gap-3 hover:bg-gray-50 active:opacity-90"
                            onClick={async () => {
                              const next = !expanded();
                              setExpandedComms(c.id, next);
                              if (next) await ensureChannelsLoaded(c.id);
                            }}
                          >
                            <Avatar
                              src={c.icon_url || ""}
                              alt="コミュニティ"
                              class="w-9 h-9 rounded-full"
                              variant="community"
                            />
                            <div class="flex-1 min-w-0 text-left">
                              <div class="text-sm font-medium truncate">
                                {c.name || c.id}
                              </div>
                              <div class="text-[12px] text-muted truncate">
                                {latestPreview(k) || "参加中"}
                              </div>
                            </div>
                            <div
                              class={`transition-transform ${
                                expanded() ? "rotate-90" : ""
                              }`}
                            >
                              ▶
                            </div>
                          </button>
                          {/* channels */}
                          <Show when={expanded()}>
                            <div class="px-2 pb-2">
                              <div class="flex flex-col gap-1">
                                <For each={channelsByCommunity[c.id] || []}>
                                  {(ch) => {
                                    const href = `/chat/c/${
                                      encodeURIComponent(c.id)
                                    }/${encodeURIComponent(ch.id)}`;
                                    const kch = `c:${c.id}#${ch.id}`;
                                    return (
                                      <div class="flex items-center gap-1 group">
                                        <A
                                          href={href}
                                          class={`flex items-center gap-2 px-3 py-1 rounded hover:bg-gray-100 dark:hover:bg-neutral-800 flex-1 min-w-0 ${
                                            chActive(c.id, ch.id)
                                              ? "bg-gray-100 dark:bg-neutral-800 font-medium"
                                              : ""
                                          }`}
                                          onClick={(e) => {
                                            e.preventDefault();
                                            setSelection({
                                              kind: "channel",
                                              communityId: c.id,
                                              channelId: ch.id,
                                            });
                                            navigate(href);
                                          }}
                                        >
                                          <span class="text-muted">#</span>
                                          <span class="truncate flex-1">
                                            {ch.name}
                                          </span>
                                          <span class="text-[11px] text-muted truncate max-w-[40%]">
                                            {latestPreview(kch)}
                                          </span>
                                        </A>
                                        <button
                                          type="button"
                                          class="p-1 rounded hover:bg-gray-200 dark:hover:bg-neutral-700 text-xs"
                                          onClick={() =>
                                            editChannel(c.id, ch.id, ch.name)}
                                        >
                                          編集
                                        </button>
                                        <button
                                          type="button"
                                          class="p-1 rounded hover:bg-gray-200 dark:hover:bg-neutral-700 text-xs"
                                          onClick={() => removeChannel(c.id, ch.id)}
                                        >
                                          削除
                                        </button>
                                      </div>
                                    );
                                  }}
                                </For>
                                <button
                                  type="button"
                                  class="mt-1 text-xs px-2 py-1 rounded bg-gray-900 text-white self-start"
                                  onClick={() =>
                                    addChannel(c.id)}
                                >
                                  + チャンネルを追加
                                </button>
                              </div>
                            </div>
                          </Show>
                        </div>
                      );
                    }}
                  </For>
                  <Show when={(comms() || []).length === 0}>
                    <div class="px-3 py-6 text-xs text-muted">
                      参加中のコミュニティはありません
                    </div>
                  </Show>
                </div>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* Center: chat */}
      <section class="min-h-0">
        <Show
          when={selection()}
          fallback={
            <div class="h-full grid place-items-center text-sm text-muted">
              表示するチャットを選択してください
            </div>
          }
        >
          <ChatWindow
            selection={selection()}
            title={selTitle()}
            localHandle={(me() as any)?.handle || me()?.id}
            channelName={selectedChannel()?.name}
          />
        </Show>
      </section>

      {/* Right: settings/info (channels removed from settings) */}
      <aside class="hidden md:flex flex-col border-l hairline">
        <div class="px-3 py-3 font-semibold flex items-center gap-2">
          <IconSettings size={18} /> 設定
        </div>
        <div class="p-3 space-y-3">
          <Show when={selection()?.kind === "dm"}>
            <div class="text-sm">
              <div class="font-medium mb-1">DM 情報</div>
              <div class="text-muted text-xs">
                相手のプロフィールやミュート設定などを配置予定
              </div>
            </div>
          </Show>
        </div>
      </aside>

      {/* Mobile list overlay when no chat is selected (inside chat area) */}
      <Show when={!selection()}>
        <div class="md:hidden absolute inset-0 bg-white dark:bg-neutral-900 z-40">
          <div class="flex flex-col h-full">
            <div class="px-4 py-4 font-semibold flex items-center gap-2 border-b hairline">
              <span class="flex items-center gap-2">
                <IconMessage size={18} /> メッセージ
              </span>
              <button
                type="button"
                class="ml-auto inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-gray-100 active:opacity-80"
                onClick={showFeatureNotReady}
                aria-label="新しいメッセージを作成"
              >
                <IconMessagePlus size={18} />
              </button>
            </div>
            <div class="px-3 py-2">
              <div class="flex rounded-full bg-gray-100 dark:bg-neutral-800 p-1 gap-1 w-full">
                <button
                  class={`flex-1 text-sm px-3 py-1 rounded-full ${
                    leftTab() === "friends"
                      ? "bg-white dark:bg-neutral-900 font-medium"
                      : ""
                  }`}
                  onClick={() => setLeftTab("friends")}
                >
                  友達
                </button>
                <button
                  class={`flex-1 text-sm px-3 py-1 rounded-full ${
                    leftTab() === "community"
                      ? "bg-white dark:bg-neutral-900 font-medium"
                      : ""
                  }`}
                  onClick={() => setLeftTab("community")}
                >
                  コミュニティ
                </button>
              </div>
            </div>
            <div
              class="flex-1 overflow-hidden"
              ref={swipe.ref}
              {...swipe.handlers}
            >
              <div
                class="flex h-full"
                classList={{
                  "transition-transform": !swipe.dragging(),
                  "duration-300": !swipe.dragging(),
                  "transition-none": swipe.dragging(),
                }}
                style={{
                  width: `${2 * 100}%`,
                  transform: swipe.sliderTransform(),
                }}
              >
                <div class="flex-none pr-1 h-full" style={{ width: "50%" }}>
                  <div class="h-full overflow-y-auto p-2" style="touch-action: pan-y;">
                    <div class="space-y-1">
                      <For each={friendEntries() || []}>
                        {({ user: dm, edge }) => {
                          const k = `dm:${dm.id}`;
                          return (
                            <A
                              href={`/chat/dm/${encodeURIComponent(dm.id)}`}
                              class={`block px-2 py-2 rounded-lg hover:bg-gray-100 active:opacity-80 ${
                                dmActive(dm.id) ? "bg-gray-100" : ""
                              }`}
                              onClick={(e) => {
                                e.preventDefault();
                                setSelection({ kind: "dm", id: dm.id });
                                navigate(`/chat/dm/${encodeURIComponent(dm.id)}`);
                              }}
                            >
                              <div class="flex items-center gap-3">
                                <Avatar
                                  src={dm.avatar_url || ""}
                                  alt="アバター"
                                  class="w-9 h-9 rounded-full"
                                />
                                <div class="flex-1 min-w-0">
                                  <div class="text-sm font-medium truncate">
                                    {dm.display_name || dm.id}
                                  </div>
                                  <div class="text-[12px] text-muted truncate">
                                    {latestPreview(k) || (edge.status || "active")}
                                  </div>
                                </div>
                              </div>
                            </A>
                          );
                        }}
                      </For>
                      <Show when={(friendEntries() || []).length === 0}>
                        <div class="px-3 py-6 text-xs text-muted">
                          友達がいません
                        </div>
                      </Show>
                    </div>
                  </div>
                </div>
                <div class="flex-none pl-1 h-full" style={{ width: "50%" }}>
                  <div class="h-full overflow-y-auto p-2" style="touch-action: pan-y;">
                    <div class="space-y-2">
                      <For each={comms() || []}>
                        {(c) => {
                          const k = `c:${c.id}#general`;
                          const expanded = () => !!expandedComms[c.id];
                          return (
                            <div
                              class={`border hairline rounded-lg overflow-hidden ${
                                selectedCommunityActive(c.id)
                                  ? "bg-gray-50 dark:bg-neutral-800/50"
                                  : ""
                              }`}
                            >
                              <button
                                type="button"
                                class="w-full px-3 py-2 flex items-center gap-3 hover:bg-gray-50 active:opacity-90"
                                onClick={async () => {
                                  const next = !expanded();
                                  setExpandedComms(c.id, next);
                                  if (next) await ensureChannelsLoaded(c.id);
                                }}
                              >
                                <Avatar
                                  src={c.icon_url || ""}
                                  alt="コミュニティ"
                                  class="w-9 h-9 rounded-full"
                                  variant="community"
                                />
                                <div class="flex-1 min-w-0 text-left">
                                  <div class="text-sm font-medium truncate">
                                    {c.name || c.id}
                                  </div>
                                  <div class="text-[12px] text-muted truncate">
                                    {latestPreview(k) || "参加中"}
                                  </div>
                                </div>
                                <div
                                  class={`transition-transform ${
                                    expanded() ? "rotate-90" : ""
                                  }`}
                                >
                                  ▶
                                </div>
                              </button>
                              <Show when={expanded()}>
                                <div class="px-2 pb-2">
                                  <div class="flex flex-col gap-1">
                                    <Show
                                      when={channelsLoading[c.id] &&
                                        !(channelsByCommunity[c.id] || []).length}
                                    >
                                      <div class="text-xs text-muted px-3 py-1">
                                        読み込み中…
                                      </div>
                                    </Show>
                                    <Show when={channelsError[c.id]}>
                                      <div class="text-xs text-red-600 px-3 py-1">
                                        {channelsError[c.id]}
                                      </div>
                                    </Show>
                                    <For each={channelsByCommunity[c.id] || []}>
                                      {(ch) => {
                                        const href = `/chat/c/${
                                          encodeURIComponent(c.id)
                                        }/${encodeURIComponent(ch.id)}`;
                                        const kch = `c:${c.id}#${ch.id}`;
                                        return (
                                          <div class="flex items-center gap-1 group">
                                            <A
                                              href={href}
                                              class={`flex items-center gap-2 px-3 py-1 rounded hover:bg-gray-100 dark:hover:bg-ne
utral-800 flex-1 min-w-0 ${
                                                chActive(c.id, ch.id)
                                                  ? "bg-gray-100 dark:bg-neutral-800 font-medium"
                                                  : ""
                                              }`}
                                              onClick={(e) => {
                                                e.preventDefault();
                                                setSelection({
                                                  kind: "channel",
                                                  communityId: c.id,
                                                  channelId: ch.id,
                                                });
                                                navigate(href);
                                              }}
                                            >
                                              <span class="text-muted">#</span>
                                              <span class="truncate flex-1">
                                                {ch.name}
                                              </span>
                                              <span class="text-[11px] text-muted truncate max-w-[40%]">
                                                {latestPreview(kch)}
                                              </span>
                                            </A>
                                            <button
                                              type="button"
                                              class="p-1 rounded hover:bg-gray-200 dark:hover:bg-neutral-700 text-xs"
                                              onClick={() =>
                                                editChannel(c.id, ch.id, ch.name)}
                                            >
                                              編集
                                            </button>
                                            <button
                                              type="button"
                                              class="p-1 rounded hover:bg-gray-200 dark:hover:bg-neutral-700 text-xs"
                                              onClick={() => removeChannel(c.id, ch.id)}
                                            >
                                              削除
                                            </button>
                                          </div>
                                        );
                                      }}
                                    </For>
                                    <Show
                                      when={!(channelsByCommunity[c.id] || [])
                                        .length &&
                                        !channelsLoading[c.id] &&
                                        !channelsError[c.id]}
                                    >
                                      <div class="text-xs text-muted px-3 py-1">
                                        チャンネルがありません
                                      </div>
                                    </Show>
                                    <button
                                      type="button"
                                      class="mt-1 text-xs px-2 py-1 rounded bg-gray-900 text-white self-start"
                                      onClick={() => addChannel(c.id)}
                                    >
                                      + チャンネルを追加
                                    </button>
                                  </div>
                                </div>
                              </Show>
                            </div>
                          );
                        }}
                      </For>
                      <Show when={(comms() || []).length === 0}>
                        <div class="px-3 py-6 text-xs text-muted">
                          参加中のコミュニティはありません
                        </div>
                      </Show>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Show>

      {/* Mobile full-screen chat overlay (covers bottom tab) */}
      <Show when={!!selection()}>
        <div class="md:hidden fixed inset-0 z-50 bg-white dark:bg-neutral-900">
          <ChatWindow
            selection={selection()}
            title={selTitle()}
            localHandle={(me() as any)?.handle || me()?.id}
            channelName={selectedChannel()?.name}
            onBack={() => {
              setMobileSettingsOpen(false);
              setSelection(null);
              navigate("/chat");
            }}
            onOpenSettings={() => setMobileSettingsOpen(true)}
          />
        </div>
      </Show>

      {/* Mobile settings drawer (channels removed) */}
      <Show when={mobileSettingsOpen()}>
        <div class="md:hidden fixed inset-0 z-[60]">
          <div
            class="absolute inset-0 bg-black/30"
            onClick={() => setMobileSettingsOpen(false)}
          >
          </div>
          <aside class="absolute right-0 top-0 h-full w-[85%] max-w-[360px] bg-white dark:bg-neutral-900 border-l hairline shadow-xl p-3 overflow-y-auto">
            <div class="px-1 py-2 font-semibold flex items-center gap-2">
              <IconSettings size={18} /> 設定
            </div>
            <div class="p-1 space-y-3">
              {/* DM info placeholder */}
              <Show when={selection()?.kind === "dm"}>
                <div class="text-sm">
                  <div class="font-medium mb-1">DM 情報</div>
                  <div class="text-muted text-xs">
                    相手のプロフィールやミュート設定などを配置予定
                  </div>
                </div>
              </Show>
            </div>
          </aside>
        </div>
      </Show>
    </div>
  );
}
