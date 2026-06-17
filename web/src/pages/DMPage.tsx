import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onMount,
  Show,
} from "solid-js";
import { useNavigate, useParams } from "@solidjs/router";
import { useRequiredActor } from "../hooks/useRequiredActor.ts";
import {
  DMContact,
  DMRequest,
  fetchDMContact,
  fetchDMContacts,
  fetchDMRequests,
  rejectDMRequest,
} from "../lib/api.ts";
import { useI18n } from "../lib/i18n.tsx";
import { DMChatPanel } from "../components/dm/DMChatPanel.tsx";
import { DMContactItem } from "../components/dm/DMContactItem.tsx";
import { PostSkeleton } from "../components/timeline/PostSkeleton.tsx";

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
  const { t } = useI18n();
  return (
    <div class="flex items-start gap-3 p-4 border-b border-neutral-800">
      <img
        src={props.request.sender.icon_url || "/default-avatar.png"}
        alt={
          props.request.sender.name || props.request.sender.preferred_username
        }
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
            {t("dm.accept")}
          </button>
          <button
            onClick={props.onReject}
            class="px-4 py-1.5 bg-neutral-700 text-white text-sm font-medium rounded-full hover:bg-neutral-600 transition-colors"
          >
            {t("dm.reject")}
          </button>
        </div>
      </div>
    </div>
  );
}

type TabType = "all" | "friends" | "communities" | "requests";

export function DMPage() {
  const actor = useRequiredActor();
  const params = useParams();
  const navigate = useNavigate();
  const [contacts, setContacts] = createSignal<DMContact[]>([]);
  const [communities, setCommunities] = createSignal<DMContact[]>([]);
  const [requests, setRequests] = createSignal<DMRequest[]>([]);
  const [requestCount, setRequestCount] = createSignal(0);
  const [selectedContact, setSelectedContact] = createSignal<DMContact | null>(
    null,
  );
  // Deep-link resolution state for a contactId not present in the loaded list.
  const [resolving, setResolving] = createSignal(false);
  const [notFound, setNotFound] = createSignal(false);
  const [loading, setLoading] = createSignal(true);
  const [listError, setListError] = createSignal<string | null>(null);
  const [activeTab, setActiveTab] = createSignal<TabType>("all");
  const [searchQuery, setSearchQuery] = createSignal("");
  let tabContainerRef!: HTMLDivElement;
  const { t } = useI18n();

  // Validate and decode contactId
  const validContactId = createMemo(() =>
    validateAndDecodeContactId(params.contactId),
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

  // Resolve a contactId that is not present in the loaded contact list by
  // fetching the actor/community directly. This turns an otherwise silent
  // dead-end (e.g. a brand-new thread, or a freshly reached community) into
  // either an opened conversation or an explicit not-found state.
  const resolveDeepLink = async (vcId: string) => {
    setResolving(true);
    setNotFound(false);
    try {
      const contact = await fetchDMContact(vcId);
      // Guard against a stale resolve if the URL changed while in flight.
      if (validContactId() !== vcId) return;
      if (contact) {
        setSelectedContact(contact);
      } else {
        setSelectedContact(null);
        setNotFound(true);
      }
    } catch (e) {
      if (validContactId() !== vcId) return;
      console.error("Failed to resolve contact:", e);
      setSelectedContact(null);
      setNotFound(true);
    } finally {
      if (validContactId() === vcId) setResolving(false);
    }
  };

  // Select the contact matching the current URL param, falling back to a
  // direct fetch when it is not in the loaded list.
  const selectFromContactId = (vcId: string) => {
    const allContacts = [...contacts(), ...communities()];
    const contact = allContacts.find((c) => c.ap_id === vcId);
    if (contact) {
      setNotFound(false);
      setResolving(false);
      setSelectedContact(contact);
    } else {
      void resolveDeepLink(vcId);
    }
  };

  // Initial load of contacts. Deep-link contact selection is handled solely by
  // the createEffect below (which fires once `loading()` flips to false), so we
  // do not resolve the URL param here to avoid a double-resolve on first load.
  onMount(() => {
    setSearchQuery("");
    void loadContacts();
  });

  // Handle contact selection when URL changes (after initial load)
  createEffect(() => {
    const vcId = validContactId();
    if (!loading() && vcId) {
      selectFromContactId(vcId);
    } else if (!vcId) {
      setSelectedContact(null);
      setNotFound(false);
      setResolving(false);
    }
  });

  // Load requests when tab changes to requests
  createEffect(() => {
    if (activeTab() === "requests") {
      loadRequests();
    }
  });

  const handleSelectContact = (contact: DMContact) => {
    setNotFound(false);
    setResolving(false);
    setSelectedContact(contact);
    navigate(`/dm/${encodeURIComponent(contact.ap_id)}`);
  };

  const handleBack = () => {
    setSelectedContact(null);
    setNotFound(false);
    setResolving(false);
    navigate("/dm");
  };

  const handleAcceptRequest = (request: DMRequest) => {
    // AP-native DM model: a conversation stays a "request" until the
    // recipient replies — replying is what accepts it; there is no separate
    // accepted state to persist (see the /api/dm/requests/accept route).
    // So "Accept" opens the conversation with the sender, where sending a
    // reply moves it out of the request list and creates the contact.
    handleSelectContact({
      type: "user",
      ap_id: request.sender.ap_id,
      username: request.sender.username,
      preferred_username: request.sender.preferred_username,
      name: request.sender.name,
      icon_url: request.sender.icon_url,
      last_message: { content: request.content, is_mine: false },
      last_message_at: request.created_at,
    });
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

  // Whether to render the deep-link resolving / not-found overlay instead of
  // the contact list (a contactId is in the URL but no contact is selected).
  const showDeepLinkState = () =>
    !showChat() && !!validContactId() && (resolving() || notFound());

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
      result = result.filter(
        (c) =>
          c.name?.toLowerCase().includes(query) ||
          c.preferred_username.toLowerCase().includes(query),
      );
    }

    return result;
  });

  const tabIndex = () => tabs.indexOf(activeTab());

  // Handle onRead
  const handleRead = () => {
    // Clear unread count locally for this contact (user or community).
    const sc = selectedContact();
    if (!sc) return;
    if (sc.type === "user") {
      setContacts((prev) =>
        prev.map((c) => (c.ap_id === sc.ap_id ? { ...c, unread_count: 0 } : c)),
      );
    } else {
      setCommunities((prev) =>
        prev.map((c) => (c.ap_id === sc.ap_id ? { ...c, unread_count: 0 } : c)),
      );
    }
  };

  return (
    <div class="flex flex-col h-full">
      {/* Chat view */}
      <Show
        when={showChat()}
        fallback={
          <Show
            when={!showDeepLinkState()}
            fallback={
              <div class="flex-1 flex flex-col items-center justify-center p-8 text-center min-h-[50vh]">
                <Show
                  when={!resolving()}
                  fallback={
                    <p class="text-neutral-400 text-lg font-medium">
                      {t("common.loading")}
                    </p>
                  }
                >
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
                        d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                  </div>
                  <p class="text-neutral-400 mb-2 text-lg font-medium">
                    {t("dm.contactNotFound")}
                  </p>
                  <p class="text-neutral-500 text-sm mb-4">
                    {t("dm.contactNotFoundHint")}
                  </p>
                  <button
                    onClick={handleBack}
                    class="px-4 py-2 rounded-full bg-neutral-800 text-white text-sm font-medium hover:bg-neutral-700 transition-colors"
                  >
                    {t("common.back")}
                  </button>
                </Show>
              </div>
            }
          >
            <>
              {/* Header - LINE style */}
              <header class="sticky top-0 bg-neutral-900/95 backdrop-blur-sm z-10">
                {/* Title bar */}
                <div class="flex items-center justify-between px-4 py-3">
                  <div class="min-w-0">
                    <h1 class="text-xl font-bold text-white">
                      {t("dm.talks")}
                    </h1>
                    <p class="text-xs text-neutral-500 truncate">
                      {t("dm.directReachHint")}
                    </p>
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
                      placeholder={t("nav.search")}
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
                    {t("timeline.all")}
                  </button>
                  <button
                    onClick={() => setActiveTab("friends")}
                    class={`px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors ${
                      activeTab() === "friends"
                        ? "text-white"
                        : "text-neutral-500"
                    }`}
                  >
                    {t("dm.filterFriends")}
                  </button>
                  <button
                    onClick={() => setActiveTab("communities")}
                    class={`px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors ${
                      activeTab() === "communities"
                        ? "text-white"
                        : "text-neutral-500"
                    }`}
                  >
                    {t("nav.groups")}
                  </button>
                  <button
                    onClick={() => setActiveTab("requests")}
                    class={`px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors relative ${
                      activeTab() === "requests"
                        ? "text-white"
                        : "text-neutral-500"
                    }`}
                  >
                    {t("dm.filterRequests")}
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
                      width:
                        tabIndex() === 0
                          ? "52px"
                          : tabIndex() === 1
                            ? "52px"
                            : tabIndex() === 2
                              ? "64px"
                              : "72px",
                      left:
                        tabIndex() === 0
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
                  <div class="px-4 py-2 flex items-center justify-between gap-3 text-sm text-red-400 bg-red-500/10">
                    <span>{listError()}</span>
                    <button
                      onClick={() => loadContacts()}
                      class="shrink-0 px-3 py-1 rounded-full bg-red-500/20 text-red-200 hover:bg-red-500/30 transition-colors text-xs"
                    >
                      {t("common.retry")}
                    </button>
                  </div>
                </Show>
                <Show when={loading()}>
                  <PostSkeleton count={6} />
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
                              onAccept={() => handleAcceptRequest(request)}
                              onReject={() =>
                                handleRejectRequest(request.sender.ap_id)
                              }
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
                        {t("dm.noRequests")}
                      </p>
                      <p class="text-neutral-500 text-sm">
                        {t("dm.noRequestsHint")}
                      </p>
                    </div>
                  </Show>
                </Show>
                <Show
                  when={
                    !loading() &&
                    activeTab() !== "requests" &&
                    currentContacts().length === 0
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
                          d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                        />
                      </svg>
                    </div>
                    <p class="text-neutral-400 mb-2 text-lg font-medium">
                      {searchQuery()
                        ? t("search.noResults")
                        : activeTab() === "all"
                          ? t("dm.noTalks")
                          : activeTab() === "friends"
                            ? t("dm.noFriends")
                            : t("groups.noGroups")}
                    </p>
                    <p class="text-neutral-500 text-sm">
                      {searchQuery()
                        ? t("dm.searchHint")
                        : activeTab() === "all"
                          ? t("dm.emptyAllHint")
                          : activeTab() === "friends"
                            ? t("dm.emptyFriendsHint")
                            : t("dm.emptyGroupsHint")}
                    </p>
                  </div>
                </Show>
                <Show
                  when={
                    !loading() &&
                    activeTab() !== "requests" &&
                    currentContacts().length > 0
                  }
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
          </Show>
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
