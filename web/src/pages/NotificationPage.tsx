import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import { useNavigate } from "@solidjs/router";
import { useSetAtom } from "solid-jotai";
import { Notification } from "../types/index.ts";
import { refreshNotificationUnreadAtom } from "../atoms/notifications.ts";
import {
  acceptFollowRequest,
  archiveAllNotifications,
  archiveNotifications,
  fetchNotifications,
  markNotificationsRead,
  rejectFollowRequest,
  unarchiveNotifications,
} from "../lib/api.ts";
import { useI18n } from "../lib/i18n.tsx";
import { formatRelativeTime } from "../lib/datetime.ts";
import { UserAvatar } from "../components/UserAvatar.tsx";
import {
  HeartIcon,
  ReplyIcon,
  RepostIcon,
} from "../components/icons/SocialIcons.tsx";
import { InlineErrorBanner } from "../components/InlineErrorBanner.tsx";
import { InlineErrorRetry } from "../components/InlineErrorRetry.tsx";
import { EmptyState } from "../components/EmptyState.tsx";
import { PostSkeleton } from "../components/timeline/PostSkeleton.tsx";
import type { JSX } from "solid-js";

// Preserve object identity for unchanged notifications across an in-place
// refresh so the `<For>` (keyed by reference) re-renders only the rows that
// actually changed, instead of rebuilding the whole list (visible flicker) on
// every focus/visibility refresh.
function mergeNotificationsById(
  prev: Notification[],
  next: Notification[],
): Notification[] {
  const prevById = new Map(prev.map((n) => [n.id, n]));
  return next.map((n) => {
    const old = prevById.get(n.id);
    return old && JSON.stringify(old) === JSON.stringify(n) ? old : n;
  });
}

const BellIcon = (props: { class?: string; strokeWidth?: number }) => (
  <svg
    class={props.class ?? "w-10 h-10"}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width={props.strokeWidth ?? 1.5}
      d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
    />
  </svg>
);

const ArchiveIcon = (props: { class?: string }) => (
  <svg
    class={props.class ?? "w-4 h-4"}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width={2}
      d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"
    />
  </svg>
);

// SVG Icons
const FollowIcon = () => (
  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width={2}
      d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
    />
  </svg>
);

const MentionIcon = () => (
  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width={2}
      d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207"
    />
  </svg>
);

const FollowRequestIcon = () => (
  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width={2}
      d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
    />
  </svg>
);

type FilterType = "all" | "follow" | "like" | "announce" | "mention" | "reply";

export function NotificationPage() {
  const { t, language } = useI18n();
  const navigate = useNavigate();
  const refreshUnread = useSetAtom(refreshNotificationUnreadAtom);
  const [error, setError] = createSignal<string | null>(null);
  const clearError = () => setError(null);
  const [loadError, setLoadError] = createSignal<string | null>(null);
  const [notifications, setNotifications] = createSignal<Notification[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [pendingAction, setPendingAction] = createSignal<
    Record<string, boolean>
  >({});
  const [filter, setFilter] = createSignal<FilterType>("all");
  // Inbox vs the archived view. Archived notifications are read-only history:
  // the load effect passes `archived=true` and skips the mark-as-read sweep.
  const [viewArchived, setViewArchived] = createSignal(false);
  const [archivingAll, setArchivingAll] = createSignal(false);
  // Per-row in-flight guard for archive/unarchive.
  const [archiving, setArchiving] = createSignal<Record<string, boolean>>({});
  // Bumping this re-runs the load effect for the current filter (retry).
  const [reloadKey, setReloadKey] = createSignal(0);
  // Whether an OLDER page exists past the last notification shown. Seeded from
  // the initial load + each load-older fetch, NOT from the in-place refresh
  // (which re-reads the newest page).
  const [hasMoreOlder, setHasMoreOlder] = createSignal(false);
  const [loadingOlder, setLoadingOlder] = createSignal(false);

  createEffect(() => {
    const currentFilter = filter();
    const archived = viewArchived();
    reloadKey();

    setNotifications([]);
    setHasMoreOlder(false);
    setLoadError(null);
    setLoading(true);

    let cancelled = false;

    const loadNotifications = async () => {
      try {
        const { notifications: data, hasMore } = await fetchNotifications({
          type: currentFilter === "all" ? undefined : currentFilter,
          archived,
        });
        if (cancelled) return;
        setNotifications(data);
        setHasMoreOlder(hasMore);

        // Archived notifications are read-only history — never mark-read here.
        // Mark unread as read — in its OWN try/catch so a failed mark-read POST
        // does NOT discard the notifications we just loaded successfully (it
        // would otherwise hit the outer catch and replace the list with the
        // error-retry UI).
        const unread = archived ? [] : data.filter((n) => !n.read);
        if (unread.length > 0) {
          try {
            await markNotificationsRead(unread.map((n) => n.id));
            if (!cancelled) {
              setNotifications((prev) =>
                prev.map((n) => (n.read ? n : { ...n, read: true })),
              );
              // Re-sync the shared badge from the backend (a filtered view may
              // not have marked every unread item, so don't blindly zero it).
              void refreshUnread();
            }
          } catch (markErr) {
            console.error("Failed to mark notifications read:", markErr);
          }
        }
      } catch (e) {
        if (!cancelled) {
          console.error("Failed to load notifications:", e);
          setLoadError(t("common.loadFailed"));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadNotifications();

    onCleanup(() => {
      cancelled = true;
    });
  });

  const retryLoad = () => setReloadKey((k) => k + 1);

  // Archive (inbox view) or unarchive (archived view) a single notification.
  // Optimistically drop the row from the current view; on failure reload to
  // restore the true state and surface an inline error.
  const handleArchiveToggle = async (notification: Notification) => {
    if (archiving()[notification.id]) return;
    const wasArchived = viewArchived();
    setArchiving((p) => ({ ...p, [notification.id]: true }));
    setNotifications((prev) => prev.filter((n) => n.id !== notification.id));
    try {
      if (wasArchived) {
        await unarchiveNotifications([notification.id]);
      } else {
        await archiveNotifications([notification.id]);
      }
      // Re-sync the badge: archiving an unread item lowers the count.
      void refreshUnread();
    } catch (e) {
      console.error("Failed to (un)archive notification:", e);
      setError(
        t(
          wasArchived
            ? "notifications.unarchiveFailed"
            : "notifications.archiveFailed",
        ),
      );
      retryLoad(); // restore the true list
    } finally {
      setArchiving((p) => {
        const next = { ...p };
        delete next[notification.id];
        return next;
      });
    }
  };

  const handleArchiveAll = async () => {
    if (archivingAll() || notifications().length === 0) return;
    setArchivingAll(true);
    try {
      await archiveAllNotifications();
      setNotifications([]);
      setHasMoreOlder(false);
      void refreshUnread();
    } catch (e) {
      console.error("Failed to archive all notifications:", e);
      setError(t("notifications.archiveAllFailed"));
      retryLoad();
    } finally {
      setArchivingAll(false);
    }
  };

  // Append the page of notifications OLDER than the last one shown. The list is
  // newest-first, so the oldest is the final element and older items are
  // appended. The cursor is a composite of (created_at, id) — `id` is the
  // activity ap_id, unique within the inbox — joined with a NUL separator
  // matching the backend's keyset cursor. A bare created_at cursor would skip
  // same-millisecond notifications straddling the page boundary. Respects the
  // active type filter.
  const loadOlder = async () => {
    if (loadingOlder()) return;
    const current = notifications();
    if (current.length === 0) return;
    const oldest = current[current.length - 1];
    if (!oldest.created_at) return;
    const before = oldest.id
      ? `${oldest.created_at}\u0000${oldest.id}`
      : oldest.created_at;
    const currentFilter = filter();
    const archived = viewArchived();
    // Capture the reload generation: a retryLoad()/filter reset mid-flight
    // rebuilds the list from page 1, so an older page resolving afterwards must
    // NOT be appended (it would graft a stale, non-contiguous page onto the
    // fresh one).
    const key = reloadKey();
    setLoadingOlder(true);
    try {
      const { notifications: older, hasMore } = await fetchNotifications({
        type: currentFilter === "all" ? undefined : currentFilter,
        before,
        archived,
      });
      if (
        filter() !== currentFilter ||
        viewArchived() !== archived ||
        reloadKey() !== key
      )
        return; // changed mid-flight
      setNotifications((prev) => {
        const ids = new Set(prev.map((n) => n.id));
        const fresh = older.filter((n) => !ids.has(n.id));
        return fresh.length > 0 ? [...prev, ...fresh] : prev;
      });
      setHasMoreOlder(hasMore);
    } catch (e) {
      console.error("Failed to load older notifications:", e);
    } finally {
      setLoadingOlder(false);
    }
  };

  // Refresh the list in place (no skeleton flash) when the page becomes
  // visible or regains focus, so an open notification view doesn't go stale
  // while only the shared badge polls.
  const refreshInPlace = async () => {
    if (loading() || loadError()) return;
    const currentFilter = filter();
    const archived = viewArchived();
    try {
      const { notifications: data } = await fetchNotifications({
        type: currentFilter === "all" ? undefined : currentFilter,
        archived,
      });
      // Ignore late responses if the filter / view changed mid-flight.
      if (filter() !== currentFilter || viewArchived() !== archived) return;
      // The in-place refresh fetches only the NEWEST page, but the list may hold
      // older pages loaded via "load older". Merge the newest page in place, then
      // re-append the still-present older items so a focus/visibility refresh
      // doesn't snap a 60-item list back to 20 (losing history + scroll context).
      setNotifications((prev) => {
        const merged = mergeNotificationsById(prev, data);
        const newIds = new Set(merged.map((n) => n.id));
        const older = prev.filter((n) => !newIds.has(n.id));
        return older.length > 0 ? [...merged, ...older] : merged;
      });

      const unread = archived ? [] : data.filter((n) => !n.read);
      if (unread.length > 0) {
        try {
          await markNotificationsRead(unread.map((n) => n.id));
          if (filter() === currentFilter) {
            // Only the still-unread rows change reference (read flips true).
            setNotifications((prev) =>
              prev.map((n) => (n.read ? n : { ...n, read: true })),
            );
            void refreshUnread();
          }
        } catch (markErr) {
          console.error("Failed to mark notifications read:", markErr);
        }
      }
    } catch (e) {
      console.error("Failed to refresh notifications:", e);
    }
  };

  createEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshInPlace();
    };
    const onFocus = () => void refreshInPlace();
    document.addEventListener("visibilitychange", onVisible);
    globalThis.addEventListener("focus", onFocus);
    onCleanup(() => {
      document.removeEventListener("visibilitychange", onVisible);
      globalThis.removeEventListener("focus", onFocus);
    });
  });

  const handleFollowRequest = async (
    notification: Notification,
    action: "accept" | "reject",
  ) => {
    if (pendingAction()[notification.id]) return;
    setPendingAction((prev) => ({ ...prev, [notification.id]: true }));
    try {
      if (action === "accept") {
        await acceptFollowRequest(notification.actor.ap_id);
      } else {
        await rejectFollowRequest(notification.actor.ap_id);
      }
      setNotifications((prev) => prev.filter((n) => n.id !== notification.id));
    } catch (e) {
      console.error("Failed to handle follow request:", e);
      setError(t("common.error"));
    } finally {
      setPendingAction((prev) => ({ ...prev, [notification.id]: false }));
    }
  };

  // Resolve the in-app route a notification points at, using the data already
  // attached to it: post-shaped events open the related post, while
  // follow-shaped events open the actor's profile.
  const notificationTarget = (notification: Notification): string | null => {
    switch (notification.type) {
      case "like":
      case "announce":
      case "mention":
      case "reply":
        return notification.object_ap_id
          ? `/post/${encodeURIComponent(notification.object_ap_id)}`
          : null;
      case "follow":
      case "follow_request":
        return `/profile/${encodeURIComponent(notification.actor.ap_id)}`;
      default:
        return null;
    }
  };

  const handleRowActivate = (notification: Notification) => {
    const target = notificationTarget(notification);
    if (target) navigate(target);
  };

  const getNotificationText = (notification: Notification): JSX.Element => {
    const actorName =
      notification.actor.name || notification.actor.preferred_username;
    switch (notification.type) {
      case "follow":
        return (
          <>
            <span class="font-bold text-white">{actorName}</span>
            {t("notifications.follow")}
          </>
        );
      case "follow_request":
        return (
          <>
            <span class="font-bold text-white">{actorName}</span>
            {t("notifications.followRequest")}
          </>
        );
      case "like":
        return (
          <>
            <span class="font-bold text-white">{actorName}</span>
            {t("notifications.like")}
          </>
        );
      case "announce":
        return (
          <>
            <span class="font-bold text-white">{actorName}</span>
            {t("notifications.repost")}
          </>
        );
      case "mention":
        return (
          <>
            <span class="font-bold text-white">{actorName}</span>
            {t("notifications.mention")}
          </>
        );
      case "reply":
        return (
          <>
            <span class="font-bold text-white">{actorName}</span>
            {t("notifications.reply")}
          </>
        );
      default:
        return <>{t("notifications.new")}</>;
    }
  };

  const getNotificationIcon = (
    type: Notification["type"],
  ): JSX.Element | null => {
    switch (type) {
      case "follow":
        return (
          <div class="p-1 bg-accent rounded-full text-white">
            <FollowIcon />
          </div>
        );
      case "follow_request":
        return (
          <div class="p-1 bg-yellow-500 rounded-full text-white">
            <FollowRequestIcon />
          </div>
        );
      case "like":
        return (
          <div class="p-1 bg-pink-500 rounded-full text-white">
            <HeartIcon class="w-4 h-4" filled stroke={false} />
          </div>
        );
      case "announce":
        return (
          <div class="p-1 bg-green-500 rounded-full text-white">
            <RepostIcon class="w-4 h-4" />
          </div>
        );
      case "mention":
        return (
          <div class="p-1 bg-purple-500 rounded-full text-white">
            <MentionIcon />
          </div>
        );
      case "reply":
        return (
          <div class="p-1 bg-sky-500 rounded-full text-white">
            <ReplyIcon class="w-4 h-4" />
          </div>
        );
      default:
        return null;
    }
  };

  // Notifications are already filtered by the server
  const filteredNotifications = () => notifications();

  const filterTabs: { key: FilterType; label: string; icon: JSX.Element }[] = [
    {
      key: "all",
      // Bell icon (consistent with the per-type tabs' SVG icons) instead of a
      // locale-dependent text glyph (「全」/"All") in the icon slot.
      label: t("notifications.filterAll"),
      icon: <BellIcon class="w-4 h-4" strokeWidth={2} />,
    },
    { key: "follow", label: t("profile.follow"), icon: <FollowIcon /> },
    {
      key: "like",
      label: t("posts.like"),
      icon: <HeartIcon class="w-4 h-4" filled stroke={false} />,
    },
    {
      key: "announce",
      label: t("posts.repost"),
      icon: <RepostIcon class="w-4 h-4" />,
    },
    {
      key: "mention",
      label: t("notifications.filterMention"),
      icon: <MentionIcon />,
    },
    {
      key: "reply",
      label: t("posts.reply"),
      icon: <ReplyIcon class="w-4 h-4" />,
    },
  ];

  return (
    <div class="flex flex-col h-full">
      <Show when={error()}>
        <InlineErrorBanner message={error()!} onClose={clearError} />
      </Show>
      {/* Header */}
      <header class="sticky top-0 bg-neutral-900/80 backdrop-blur-sm border-b border-neutral-900 z-10">
        <div class="flex items-center justify-between gap-2 px-4 py-3">
          <h1 class="text-xl font-bold">{t("notifications.title")}</h1>
          <div class="flex items-center gap-1">
            {/* Only on the unfiltered inbox: "archive all" archives EVERY type
                (the backend has no type predicate), so showing it under a single
                type filter would silently archive the hidden types too. */}
            <Show
              when={
                !viewArchived() &&
                filter() === "all" &&
                notifications().length > 0
              }
            >
              <button
                onClick={handleArchiveAll}
                disabled={archivingAll()}
                class="px-3 py-1.5 text-sm text-neutral-300 rounded-full hover:bg-neutral-800 transition-colors disabled:opacity-50"
              >
                {t("notifications.archiveAll")}
              </button>
            </Show>
            <button
              onClick={() => setViewArchived((v) => !v)}
              aria-pressed={viewArchived()}
              class={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-full transition-colors ${
                viewArchived()
                  ? "bg-neutral-800 text-white"
                  : "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
              }`}
            >
              <ArchiveIcon />
              <span>
                {viewArchived()
                  ? t("notifications.showInbox")
                  : t("notifications.showArchived")}
              </span>
            </button>
          </div>
        </div>
        {/* Filter tabs */}
        <div
          role="tablist"
          aria-label={t("notifications.title")}
          class="flex overflow-x-auto scrollbar-hide border-t border-neutral-900"
        >
          <For each={filterTabs}>
            {(tab) => (
              <button
                role="tab"
                aria-selected={filter() === tab.key}
                onClick={() => setFilter(tab.key)}
                class={`flex items-center gap-1.5 px-4 py-2.5 text-sm whitespace-nowrap transition-colors border-b-2 ${
                  filter() === tab.key
                    ? "text-white border-accent"
                    : "text-neutral-500 border-transparent hover:text-neutral-300"
                }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            )}
          </For>
        </div>
      </header>

      {/* Notifications */}
      <div class="flex-1 overflow-y-auto">
        <Show
          when={!loadError()}
          fallback={
            <InlineErrorRetry
              message={loadError()!}
              retryLabel={t("common.retry")}
              onRetry={retryLoad}
            />
          }
        >
          <Show when={!loading()} fallback={<PostSkeleton count={6} />}>
            <Show
              when={filteredNotifications().length > 0}
              fallback={
                <EmptyState
                  icon={
                    viewArchived() ? (
                      <ArchiveIcon class="w-10 h-10" />
                    ) : (
                      <BellIcon />
                    )
                  }
                  title={
                    viewArchived()
                      ? t("notifications.emptyArchived")
                      : filter() === "all"
                        ? t("notifications.empty")
                        : t("notifications.emptyFiltered")
                  }
                  hint={
                    !viewArchived() && filter() === "all"
                      ? t("notifications.emptyHint")
                      : undefined
                  }
                />
              }
            >
              <For each={filteredNotifications()}>
                {(notification) => {
                  const target = notificationTarget(notification);
                  return (
                    <div
                      class={`flex items-start gap-3 px-4 py-3 border-b border-neutral-900 transition-colors ${
                        !notification.read ? "bg-neutral-900/50" : ""
                      }`}
                    >
                      <Dynamic
                        component={target ? "a" : "div"}
                        href={target ?? undefined}
                        onClick={
                          target
                            ? (e: MouseEvent) => {
                                e.preventDefault();
                                handleRowActivate(notification);
                              }
                            : undefined
                        }
                        class={`flex items-start gap-3 flex-1 min-w-0 rounded-md hover:bg-neutral-900/30 transition-colors ${
                          target ? "cursor-pointer" : ""
                        }`}
                      >
                        <div class="relative shrink-0">
                          <UserAvatar
                            avatarUrl={notification.actor.icon_url}
                            name={
                              notification.actor.name ||
                              notification.actor.preferred_username
                            }
                            size={40}
                          />
                          <span class="absolute -bottom-1 -right-1">
                            {getNotificationIcon(notification.type)}
                          </span>
                        </div>
                        <div class="flex-1 min-w-0">
                          <p class="text-[15px] text-neutral-400">
                            {getNotificationText(notification)}
                          </p>
                          <p class="text-sm text-neutral-600 mt-1">
                            {formatRelativeTime(notification.created_at, {
                              locale: language(),
                            })}
                          </p>
                        </div>
                      </Dynamic>
                      <Show when={notification.type === "follow_request"}>
                        <div class="flex gap-2 shrink-0 self-center">
                          <button
                            onClick={() =>
                              handleFollowRequest(notification, "accept")
                            }
                            disabled={pendingAction()[notification.id]}
                            class="px-3 py-1 text-xs bg-accent text-white rounded-full transition-colors disabled:opacity-50"
                          >
                            {t("dm.accept")}
                          </button>
                          <button
                            onClick={() =>
                              handleFollowRequest(notification, "reject")
                            }
                            disabled={pendingAction()[notification.id]}
                            class="px-3 py-1 text-xs bg-neutral-800 text-neutral-200 rounded-full hover:bg-neutral-700 transition-colors disabled:opacity-50"
                          >
                            {t("dm.reject")}
                          </button>
                        </div>
                      </Show>
                      <button
                        onClick={() => handleArchiveToggle(notification)}
                        disabled={archiving()[notification.id]}
                        aria-label={t(
                          viewArchived()
                            ? "notifications.unarchive"
                            : "notifications.archive",
                        )}
                        title={t(
                          viewArchived()
                            ? "notifications.unarchive"
                            : "notifications.archive",
                        )}
                        class="shrink-0 self-center p-2 rounded-full text-neutral-500 hover:text-neutral-200 hover:bg-neutral-800 transition-colors disabled:opacity-50"
                      >
                        <ArchiveIcon />
                      </button>
                    </div>
                  );
                }}
              </For>
              <Show when={hasMoreOlder()}>
                <div class="flex justify-center py-4">
                  <button
                    onClick={loadOlder}
                    disabled={loadingOlder()}
                    class="rounded-full bg-neutral-800 px-4 py-1.5 text-sm text-neutral-300 hover:bg-neutral-700 transition-colors disabled:opacity-50"
                  >
                    {loadingOlder()
                      ? t("common.loading")
                      : t("notifications.loadOlder")}
                  </button>
                </div>
              </Show>
            </Show>
          </Show>
        </Show>
      </div>
    </div>
  );
}

export default NotificationPage;
