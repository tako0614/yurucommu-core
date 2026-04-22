import { createEffect, createSignal, For, on, Show } from "solid-js";
import { A } from "@solidjs/router";
import { useRequiredActor } from "../../hooks/useRequiredActor.ts";
import type { RecommendedUser } from "../../lib/api/recommendations.ts";
import { fetchRecommendedUsers, follow } from "../../lib/api.ts";
import { UserAvatar } from "../UserAvatar.tsx";
import { PluginSlot } from "../PluginSlot.tsx";

function RecommendedUserCard(props: {
  user: RecommendedUser;
  onFollowed: (apId: string) => void;
}) {
  const [following, setFollowing] = createSignal(false);
  const [loading, setLoading] = createSignal(false);

  const handleFollow = async (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (loading() || following()) return;

    setLoading(true);
    try {
      await follow(props.user.ap_id);
      setFollowing(true);
      setTimeout(() => props.onFollowed(props.user.ap_id), 600);
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
        disabled={loading() || following()}
        class={`px-3 py-1 rounded-full text-xs font-bold transition-colors shrink-0 ${
          following()
            ? "bg-transparent text-neutral-500 border border-neutral-700"
            : "bg-white text-black hover:bg-neutral-200"
        }`}
      >
        {following() ? "フォロー中" : "フォロー"}
      </button>
    </A>
  );
}

export function RightSidebar() {
  const actor = useRequiredActor();
  const [users, setUsers] = createSignal<RecommendedUser[]>([]);
  const [loading, setLoading] = createSignal(true);

  createEffect(on(() => actor.ap_id, () => {
    let cancelled = false;
    fetchRecommendedUsers()
      .then((data) => {
        if (!cancelled) setUsers(data);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }));

  const handleFollowed = (apId: string) => {
    setUsers((prev) => prev.filter((u) => u.ap_id !== apId));
  };

  const showRecommendations = () => loading() || users().length > 0;

  return (
    <div class="sticky top-0">
      <Show when={showRecommendations()}>
        <div class="p-4 pb-0">
          <div class="bg-neutral-900/50 rounded-2xl overflow-hidden">
            <h2 class="text-lg font-bold px-4 pt-4 pb-2">おすすめユーザー</h2>
            <Show
              when={!loading()}
              fallback={
                <div class="px-4 py-6 text-center text-sm text-neutral-500">
                  読み込み中...
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
