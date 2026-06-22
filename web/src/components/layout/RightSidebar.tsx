import { createEffect, createSignal, For, on, onCleanup, Show } from "solid-js";
import { A } from "@solidjs/router";
import { useRequiredActor } from "../../hooks/useRequiredActor.ts";
import type { RecommendedUser } from "../../lib/api/recommendations.ts";
import { fetchRecommendedUsers, follow } from "../../lib/api.ts";
import { UserAvatar } from "../UserAvatar.tsx";
import { PluginSlot } from "../PluginSlot.tsx";
import { useI18n } from "../../lib/i18n.tsx";

function RecommendedUserCard(props: {
  user: RecommendedUser;
  onFollowed: (apId: string) => void;
}) {
  const { t } = useI18n();
  const [following, setFollowing] = createSignal(false);
  const [requested, setRequested] = createSignal(false);
  const [loading, setLoading] = createSignal(false);
  // Clear the post-follow dismissal timer if the card unmounts first, so the
  // 600ms callback can't fire onFollowed on a torn-down parent.
  let followTimeout: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(followTimeout));

  const handleFollow = async (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (loading() || following() || requested()) return;

    setLoading(true);
    try {
      const { status } = await follow(props.user.ap_id);
      if (status === "pending") {
        // A private/remote follow lands as a pending request, NOT an accepted
        // follow — show "Requested" and keep the card rather than claiming
        // "Following" and dismissing it.
        setRequested(true);
      } else {
        setFollowing(true);
        followTimeout = setTimeout(
          () => props.onFollowed(props.user.ap_id),
          600,
        );
      }
    } catch {
      // Silent fail for non-critical feature
    } finally {
      setLoading(false);
    }
  };

  return (
    <A
      href={`/profile/${encodeURIComponent(props.user.ap_id)}`}
      class="flex items-center gap-3 px-4 py-3 hover:bg-neutral-800/50 transition-colors"
    >
      <UserAvatar
        avatarUrl={props.user.icon_url}
        name={props.user.name || props.user.preferred_username}
        size="small"
      />
      <div class="flex-1 min-w-0">
        <div class="text-sm font-bold text-white truncate">
          {props.user.name || props.user.preferred_username}
        </div>
        <div class="text-xs text-neutral-500 truncate">
          @{props.user.username}
        </div>
      </div>
      <button
        onClick={handleFollow}
        disabled={loading() || following() || requested()}
        class={`px-3 py-1 rounded-full text-xs font-bold transition-colors shrink-0 ${
          following() || requested()
            ? "bg-transparent text-neutral-500 border border-neutral-700"
            : "bg-white text-black hover:bg-neutral-200"
        }`}
      >
        {following()
          ? t("profile.following")
          : requested()
            ? t("profile.followRequested")
            : t("profile.follow")}
      </button>
    </A>
  );
}

export function RightSidebar() {
  const { t } = useI18n();
  const actor = useRequiredActor();
  const [users, setUsers] = createSignal<RecommendedUser[]>([]);
  const [loading, setLoading] = createSignal(true);

  createEffect(
    on(
      () => actor.ap_id,
      () => {
        let cancelled = false;
        // Solid does NOT treat a value returned from an effect/on() callback as
        // cleanup (on() forwards it as the next prevInput), so register the
        // cancel flag via onCleanup — it runs before the next actor change and
        // on unmount, preventing a stale in-flight response from overwriting a
        // newer actor's recommendations.
        onCleanup(() => {
          cancelled = true;
        });
        fetchRecommendedUsers()
          .then((data) => {
            if (!cancelled) setUsers(data);
          })
          .catch((e) => {
            // Non-critical feature: log instead of leaving an unhandled rejection.
            if (!cancelled) console.error("Failed to load recommendations", e);
          })
          .finally(() => {
            if (!cancelled) setLoading(false);
          });
      },
    ),
  );

  const handleFollowed = (apId: string) => {
    setUsers((prev) => prev.filter((u) => u.ap_id !== apId));
  };

  const showRecommendations = () => loading() || users().length > 0;

  return (
    <div class="sticky top-0">
      <Show when={showRecommendations()}>
        <div class="p-4 pb-0">
          <div class="bg-neutral-900/50 rounded-2xl overflow-hidden">
            <h2 class="text-lg font-bold px-4 pt-4 pb-2">
              {t("profile.suggestedUsers")}
            </h2>
            <Show
              when={!loading()}
              fallback={
                <div class="px-4 py-6 text-center text-sm text-neutral-500">
                  {t("common.loading")}
                </div>
              }
            >
              <For each={users()}>
                {(user) => (
                  <RecommendedUserCard
                    user={user}
                    onFollowed={handleFollowed}
                  />
                )}
              </For>
            </Show>
          </div>
        </div>
      </Show>
      <PluginSlot name="right-sidebar.below-recommendations" />
    </div>
  );
}
