import { createEffect, createMemo, For, onMount, Show } from "solid-js";
import { useNavigate, useParams } from "@solidjs/router";
import { atom } from "jotai";
import { useAtom } from "solid-jotai";
import { useRequiredActor } from "../hooks/useRequiredActor.ts";
import {
  acceptDMRequest,
  DMContact,
  DMRequest,
  fetchDMContacts,
  fetchDMRequests,
  rejectDMRequest,
} from "../lib/api.ts";
import { useI18n } from "../lib/i18n.tsx";
import { DMChatPanel } from "../components/dm/DMChatPanel.tsx";
import { DMContactItem } from "../components/dm/DMContactItem.tsx";

/**
 * Validate and decode contactId URL parameter
 * ActivityPub IDs are typically URLs like https://example.com/users/username
 * Returns null if the contactId is invalid
 */
function validateAndDecodeContactId(
  contactId: string | undefined,
): string | null {
  if (!contactId) return null;

  try {
    const decoded = decodeURIComponent(contactId);

    // ActivityPub ID validation:
    // 1. Must be a valid URL format (for remote actors)
    // 2. Or a local identifier pattern
    // Max length check to prevent DoS
    if (decoded.length > 2048) {
      console.warn("ContactId too long:", decoded.length);
      return null;
    }

    // Check if it's a valid URL (ActivityPub IDs are typically URLs)
    try {
      const url = new URL(decoded);
      // Only allow http and https protocols
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        console.warn("Invalid protocol in contactId:", url.protocol);
        return null;
      }
      return decoded;
    } catch {
      // Not a URL, check if it matches local identifier pattern
      // Local IDs might be simple strings without special characters
      // Allow alphanumeric, hyphens, underscores, and dots
      if (/^[\w\-.@]+$/.test(decoded)) {
        return decoded;
      }
      console.warn("Invalid contactId format:", decoded);
      return null;
    }
  } catch (e) {
    console.warn("Failed to decode contactId:", e);
    return null;
  }
}

interface RequestItemProps {
  request: DMRequest;
  onAccept: () => void;
  onReject: () => void;
}

function RequestItem(props: RequestItemProps) {
  return (
    <div class="flex items-start gap-3 p-4 border-b border-neutral-800">
      <img
        src={props.request.sender.icon_url || "/default-avatar.png"}
        alt={props.request.sender.name ||
          props.request.sender.preferred_username}
        class="w-12 h-12 rounded-full object-cover"
      />
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2">
          <span class="font-medium text-white truncate">
            {props.request.sender.name ||
              props.request.sender.preferred_username}
          </span>
          <span class="text-sm text-neutral-500 truncate">
            @{props.request.sender.preferred_username}
          </span>
        </div>
        <p class="text-sm text-neutral-400 mt-1 line-clamp-2">
          {props.request.content}
        </p>
        <div class="flex gap-2 mt-3">
          <button
            onClick={props.onAccept}
            class="px-4 py-1.5 bg-green-500 text-white text-sm font-medium rounded-full hover:bg-green-600 transition-colors"
          >
            承認
          </button>
          <button
            onClick={props.onReject}
            class="px-4 py-1.5 bg-neutral-700 text-white text-sm font-medium rounded-full hover:bg-neutral-600 transition-colors"
          >
            拒否
          </button>
        </div>
      </div>
    </div>
  );
}

type TabType = "all" | "friends" | "communities" | "requests";

// Atoms defined at module level
const dm_contactsAtom = atom<DMContact[]>([]);
const dm_communitiesAtom = atom<DMContact[]>([]);
const dm_requestsAtom = atom<DMRequest[]>([]);
const dm_requestCountAtom = atom(0);
const dm_selectedContactAtom = atom<DMContact | null>(null);
const dm_loadingAtom = atom(true);
const dm_listErrorAtom = atom<string | null>(null);
const dm_activeTabAtom = atom<TabType>("all");
const dm_searchQueryAtom = atom("");

export function DMPage() {
  const actor = useRequiredActor();
  const params = useParams();
  const navigate = useNavigate();
  const [contacts, setContacts] = useAtom(dm_contactsAtom);
  const [communities, setCommunities] = useAtom(dm_communitiesAtom);
  const [requests, setRequests] = useAtom(dm_requestsAtom);
  const [requestCount, setRequestCount] = useAtom(dm_requestCountAtom);
  const [selectedContact, setSelectedContact] = useAtom(dm_selectedContactAtom);
  const [loading, setLoading] = useAtom(dm_loadingAtom);
  const [listError, setListError] = useAtom(dm_listErrorAtom);
  const [activeTab, setActiveTab] = useAtom(dm_activeTabAtom);
  const [searchQuery, setSearchQuery] = useAtom(dm_searchQueryAtom);
  let tabContainerRef!: HTMLDivElement;
  const { t } = useI18n();

  // Validate and decode contactId
  const validContactId = createMemo(
    () => validateAndDecodeContactId(params.contactId),
  );

  // Touch handling for swipe
  let touchStartX = 0;
  let touchEndX = 0;

  // Memoize error message to prevent unnecessary re-renders
  const errorMessage = createMemo(() => t("common.error"));

  // Load contacts - no dependencies on contactId to prevent reloading
  const loadContacts = async () => {
    // Only show loading if no cached data
    if (contacts().length === 0 && communities().length === 0) setLoading(true);
    setListError(null);
    try {
      const data = await fetchDMContacts();
      setContacts(data.mutual_followers);
      setCommunities(data.communities);
      setRequestCount(data.request_count);
      return data;
    } catch (e) {
      console.error("Failed to load contacts:", e);
      setListError(errorMessage());
      return null;
    } finally {
      setLoading(false);
    }
  };

  const loadRequests = async () => {
    setListError(null);
    try {
      const data = await fetchDMRequests();
      setRequests(data);
    } catch (e) {
      console.error("Failed to load requests:", e);
      setListError(errorMessage());
    }
  };

  // Initial load of contacts
  onMount(async () => {
    setSearchQuery("");
    const data = await loadContacts();

    // Select contact from URL param after initial load
    if (data && validContactId()) {
      const allContacts = [...data.mutual_followers, ...data.communities];
      const contact = allContacts.find((c) => c.ap_id === validContactId());
      setSelectedContact(contact || null);
    }
  });

  // Handle contact selection when URL changes (after initial load)
  createEffect(() => {
    const vcId = validContactId();
    if (!loading() && vcId) {
      const allContacts = [...contacts(), ...communities()];
      const contact = allContacts.find((c) => c.ap_id === vcId);
      setSelectedContact(contact || null);
    } else if (!vcId) {
      setSelectedContact(null);
    }
  });

  // Load requests when tab changes to requests
  createEffect(() => {
    if (activeTab() === "requests") {
      loadRequests();
    }
  });

  const handleSelectContact = (contact: DMContact) => {
    setSelectedContact(contact);
    navigate(`/dm/${encodeURIComponent(contact.ap_id)}`);
  };

  const handleBack = () => {
    setSelectedContact(null);
    navigate("/dm");
  };

  const handleAcceptRequest = async (senderApId: string) => {
    try {
      await acceptDMRequest(senderApId);
      setRequests((prev) => prev.filter((r) => r.sender.ap_id !== senderApId));
      setRequestCount((prev) => Math.max(0, prev - 1));
      loadContacts(); // Reload contacts to show new contact
    } catch (e) {
      console.error("Failed to accept request:", e);
      setListError(errorMessage());
    }
  };

  const handleRejectRequest = async (senderApId: string) => {
    try {
      await rejectDMRequest(senderApId);
      setRequests((prev) => prev.filter((r) => r.sender.ap_id !== senderApId));
      setRequestCount((prev) => Math.max(0, prev - 1));
    } catch (e) {
      console.error("Failed to reject request:", e);
      setListError(errorMessage());
    }
  };

  // Swipe handlers
  const tabs: TabType[] = ["all", "friends", "communities", "requests"];

  const handleTouchStart = (e: TouchEvent) => {
    touchStartX = e.touches[0].clientX;
  };

  const handleTouchMove = (e: TouchEvent) => {
    touchEndX = e.touches[0].clientX;
  };

  const handleTouchEnd = () => {
    const diff = touchStartX - touchEndX;
    const threshold = 50;
    const currentIndex = tabs.indexOf(activeTab());

    if (Math.abs(diff) > threshold) {
      if (diff > 0 && currentIndex < tabs.length - 1) {
        setActiveTab(tabs[currentIndex + 1]);
      } else if (diff < 0 && currentIndex > 0) {
        setActiveTab(tabs[currentIndex - 1]);
      }
    }
  };

  const showChat = () => selectedContact() !== null;

  // Get current tab's content with search filter
  const currentContacts = createMemo(() => {
    let result: DMContact[] = [];
    switch (activeTab()) {
      case "all":
        result = [...contacts(), ...communities()].sort((a, b) => {
          const aTime = a.last_message_at
            ? new Date(a.last_message_at).getTime()
            : 0;
          const bTime = b.last_message_at
            ? new Date(b.last_message_at).getTime()
            : 0;
          return bTime - aTime;
        });
        break;
      case "friends":
        result = contacts();
        break;
      case "communities":
        result = communities();
        break;
      default:
        result = [];
    }

    // Apply search filter
    if (searchQuery().trim()) {
      const query = searchQuery().toLowerCase();
      result = result.filter((c) =>
        (c.name?.toLowerCase().includes(query)) ||
        c.preferred_username.toLowerCase().includes(query)
      );
    }

    return result;
  });

  const tabIndex = () => tabs.indexOf(activeTab());

  // Handle onRead
  const handleRead = () => {
    // Clear unread count locally for this contact
    const sc = selectedContact();
    if (sc?.type === "user") {
      setContacts((prev) =>
        prev.map((c) => c.ap_id === sc.ap_id ? { ...c, unread_count: 0 } : c)
      );
    }
  };

  return (
    <div class="flex flex-col h-full">
      {/* Chat view */}
      <Show
        when={showChat()}
        fallback={
          <>
            {/* Header - LINE style */}
            <header class="sticky top-0 bg-neutral-900/95 backdrop-blur-sm z-10">
              {/* Title bar with icons */}
              <div class="flex items-center justify-between px-4 py-3">
                <h1 class="text-xl font-bold text-white">トーク</h1>
                <div class="flex items-center gap-2">
                  {/* Search icon */}
                  <button
                    aria-label="Search"
                    class="p-2 text-neutral-400 hover:text-white transition-colors"
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
                        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                      />
                    </svg>
                  </button>
                  {/* New chat icon */}
                  <button
                    aria-label="New chat"
                    class="p-2 text-neutral-400 hover:text-white transition-colors"
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
                        d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                      />
                    </svg>
                  </button>
                  {/* More icon */}
                  <button
                    aria-label="More options"
                    class="p-2 text-neutral-400 hover:text-white transition-colors"
                  >
                    <svg
                      class="w-6 h-6"
                      fill="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Search bar */}
              <div class="px-4 pb-3">
                <div class="relative">
                  <svg
                    class="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-neutral-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width={2}
                      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                    />
                  </svg>
                  <input
                    type="text"
                    value={searchQuery()}
                    onInput={(e) => setSearchQuery(e.currentTarget.value)}
                    placeholder="検索"
                    class="w-full pl-10 pr-4 py-2 bg-neutral-900 rounded-lg text-white placeholder-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-700"
                  />
                </div>
              </div>

              {/* Tab bar - LINE style with underline on active */}
              <div class="relative flex overflow-x-auto scrollbar-hide border-b border-neutral-900">
                <button
                  onClick={() => setActiveTab("all")}
                  class={`px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors ${
                    activeTab() === "all" ? "text-white" : "text-neutral-500"
                  }`}
                >
                  すべて
                </button>
                <button
                  onClick={() => setActiveTab("friends")}
                  class={`px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors ${
                    activeTab() === "friends"
                      ? "text-white"
                      : "text-neutral-500"
                  }`}
                >
                  友だち
                </button>
                <button
                  onClick={() => setActiveTab("communities")}
                  class={`px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors ${
                    activeTab() === "communities"
                      ? "text-white"
                      : "text-neutral-500"
                  }`}
                >
                  グループ
                </button>
                <button
                  onClick={() => setActiveTab("requests")}
                  class={`px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors relative ${
                    activeTab() === "requests"
                      ? "text-white"
                      : "text-neutral-500"
                  }`}
                >
                  リクエスト
                  <Show when={requestCount() > 0}>
                    <span class="absolute top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-green-500 rounded-full text-[10px] flex items-center justify-center text-white font-bold">
                      {requestCount() > 99 ? "99+" : requestCount()}
                    </span>
                  </Show>
                </button>
                {/* Tab indicator - underline style */}
                <div
                  class="absolute bottom-0 h-0.5 bg-green-500 transition-all duration-200"
                  style={{
                    width: tabIndex() === 0
                      ? "52px"
                      : tabIndex() === 1
                      ? "52px"
                      : tabIndex() === 2
                      ? "64px"
                      : "72px",
                    left: tabIndex() === 0
                      ? "0px"
                      : tabIndex() === 1
                      ? "68px"
                      : tabIndex() === 2
                      ? "136px"
                      : "216px",
                  }}
                />
              </div>
            </header>

            {/* Swipeable content area */}
            <div
              ref={tabContainerRef!}
              class="flex-1 overflow-y-auto"
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
            >
              <Show when={listError()}>
                <div class="px-4 py-2 text-sm text-red-400 bg-red-500/10">
                  {listError()}
                </div>
              </Show>
              <Show when={loading()}>
                <div class="p-8 text-center text-neutral-500">Loading...</div>
              </Show>
              <Show when={!loading() && activeTab() === "requests"}>
                <Show
                  when={requests().length === 0}
                  fallback={
                    <div>
                      <For each={requests()}>
                        {(request) => (
                          <RequestItem
                            request={request}
                            onAccept={() =>
                              handleAcceptRequest(request.sender.ap_id)}
                            onReject={() =>
                              handleRejectRequest(request.sender.ap_id)}
                          />
                        )}
                      </For>
                    </div>
                  }
                >
                  <div class="flex-1 flex flex-col items-center justify-center p-8 text-center min-h-[50vh]">
                    <div class="w-20 h-20 mb-4 rounded-full bg-neutral-800 flex items-center justify-center">
                      <svg
                        class="w-10 h-10 text-neutral-500"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width={1.5}
                          d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                        />
                      </svg>
                    </div>
                    <p class="text-neutral-400 mb-2 text-lg font-medium">
                      リクエストがありません
                    </p>
                    <p class="text-neutral-500 text-sm">
                      新しいメッセージリクエストが<br />ここに表示されます
                    </p>
                  </div>
                </Show>
              </Show>
              <Show
                when={!loading() && activeTab() !== "requests" &&
                  currentContacts().length === 0}
              >
                <div class="flex-1 flex flex-col items-center justify-center p-8 text-center min-h-[50vh]">
                  <div class="w-20 h-20 mb-4 rounded-full bg-neutral-800 flex items-center justify-center">
                    <svg
                      class="w-10 h-10 text-neutral-500"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width={1.5}
                        d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                      />
                    </svg>
                  </div>
                  <p class="text-neutral-400 mb-2 text-lg font-medium">
                    {searchQuery()
                      ? "検索結果がありません"
                      : activeTab() === "all"
                      ? "トークがありません"
                      : activeTab() === "friends"
                      ? "友だちがいません"
                      : "グループがありません"}
                  </p>
                  <p class="text-neutral-500 text-sm">
                    {searchQuery()
                      ? "別のキーワードで検索してみてください"
                      : activeTab() === "all"
                      ? "友だちやグループとの\nトークがここに表示されます"
                      : activeTab() === "friends"
                      ? "友だちとフォローすると\nトークがここに表示されます"
                      : "参加しているコミュニティの\nトークがここに表示されます"}
                  </p>
                </div>
              </Show>
              <Show
                when={!loading() && activeTab() !== "requests" &&
                  currentContacts().length > 0}
              >
                <div class="divide-y divide-neutral-900">
                  <For each={currentContacts()}>
                    {(contact) => (
                      <DMContactItem
                        contact={contact}
                        onClick={() => handleSelectContact(contact)}
                        unreadCount={contact.unread_count || 0}
                      />
                    )}
                  </For>
                </div>
              </Show>
            </div>
          </>
        }
      >
        <DMChatPanel
          contact={selectedContact()!}
          actor={actor}
          onBack={handleBack}
          onRead={handleRead}
        />
      </Show>
    </div>
  );
}

export default DMPage;
