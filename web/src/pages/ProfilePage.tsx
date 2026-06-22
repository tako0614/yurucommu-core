import { createEffect, createSignal, lazy, on, Show, Suspense } from "solid-js";
import { useParams } from "@solidjs/router";
import { decodeApIdParam } from "../lib/routeApId.ts";
import { useRequiredActor } from "../hooks/useRequiredActor.ts";
import { Actor, Post } from "../types/index.ts";
import {
  blockUser,
  fetchActor,
  fetchActorPosts,
  fetchFollowers,
  fetchFollowing,
  follow,
  muteUser,
  unfollow,
  updateProfile,
} from "../lib/api.ts";
import { toggleLike } from "../atoms/posts.ts";
import { useI18n } from "../lib/i18n.tsx";
import { useSetAtom } from "solid-jotai";
import { pushToast, toastsAtom } from "../atoms/toast.ts";
import { InlineErrorBanner } from "../components/InlineErrorBanner.tsx";
import { InlineErrorRetry } from "../components/InlineErrorRetry.tsx";
import { ProfileHeader } from "../components/profile/ProfileHeader.tsx";
import { ProfileSummary } from "../components/profile/ProfileSummary.tsx";
import { ProfilePostsSection } from "../components/profile/ProfilePostsSection.tsx";
import { ProfileEditModal } from "../components/profile/ProfileEditModal.tsx";
import { ProfileFollowModal } from "../components/profile/ProfileFollowModal.tsx";
// Lazy: the QR modal (its QR display + scanner-trigger UI, ~static qrcode-
// generator) is only mounted when the user opens it, so keep it out of the
// ProfilePage critical chunk.
const QRCodeModal = lazy(() =>
  import("../components/QRCodeModal.tsx").then((m) => ({
    default: m.QRCodeModal,
  })),
);
import { ConfirmSheet } from "../components/ConfirmSheet.tsx";
import { PostSkeleton } from "../components/timeline/PostSkeleton.tsx";

const PROFILE_POSTS_PAGE = 20;

export function ProfilePage() {
  const actor = useRequiredActor();
  const { t, language } = useI18n();
  const setToasts = useSetAtom(toastsAtom);
  const [error, setError] = createSignal<string | null>(null);
  const clearError = () => setError(null);
  const params = useParams();
  const [profile, setProfile] = createSignal<Actor | null>(null);
  const [posts, setPosts] = createSignal<Post[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [postsHasMore, setPostsHasMore] = createSignal(false);
  const [postsCursor, setPostsCursor] = createSignal<string | null>(null);
  const [loadingMorePosts, setLoadingMorePosts] = createSignal(false);
  const [isFollowing, setIsFollowing] = createSignal(false);
  // A private/remote follow can be pending the target's approval; track it so we
  // don't present a pending request as an accepted follow.
  const [followPending, setFollowPending] = createSignal(false);
  const [followBusy, setFollowBusy] = createSignal(false);
  const [activeTab, setActiveTab] = createSignal<"posts">("posts");
  // List is the default: Note (text) is yurucommu's primary content type, so
  // the profile must show text posts up front rather than a media-only grid
  // that reads "no media posts" for a text-first poster. A media grid toggle
  // remains available.
  const [postsView, setPostsView] = createSignal<"grid" | "list">("list");
  const [showEditModal, setShowEditModal] = createSignal(false);
  const [editName, setEditName] = createSignal("");
  const [editSummary, setEditSummary] = createSignal("");
  const [editIconUrl, setEditIconUrl] = createSignal<string | undefined>(
    undefined,
  );
  const [editHeaderUrl, setEditHeaderUrl] = createSignal<string | undefined>(
    undefined,
  );
  const [editFields, setEditFields] = createSignal<
    { name: string; value: string }[]
  >([]);
  const [saving, setSaving] = createSignal(false);
  const [showMenu, setShowMenu] = createSignal(false);
  const [showFollowModal, setShowFollowModal] = createSignal<
    "followers" | "following" | null
  >(null);
  const [editIsPrivate, setEditIsPrivate] = createSignal(false);
  const [followModalActors, setFollowModalActors] = createSignal<Actor[]>([]);
  const [followModalLoading, setFollowModalLoading] = createSignal(false);
  const [followModalError, setFollowModalError] = createSignal<string | null>(
    null,
  );
  const [showQr, setShowQr] = createSignal(false);
  // Pending block/mute confirmation for the viewed (other) user.
  const [pendingModeration, setPendingModeration] = createSignal<
    "block" | "mute" | null
  >(null);

  // Resolve which actor this page shows:
  //   /profile/<encoded ap_id>  -> params.actorId (any local OR remote actor)
  //   /users/<username>         -> params.username (a LOCAL handle — the clean,
  //                                 federation-facing profile URL advertised as
  //                                 the actor `url` + WebFinger profile-page; a
  //                                 local actor's ap_id is deterministic, so
  //                                 reconstruct it from this origin)
  //   (neither)                 -> the logged-in actor's own profile
  const targetActorId = () =>
    params.actorId
      ? decodeApIdParam(params.actorId)
      : params.username
        ? `${window.location.origin}/ap/users/${params.username}`
        : actor.ap_id;
  const isOwnProfile = () => targetActorId() === actor.ap_id;
  // The handle shown in the header. Once the profile is loaded we always use its
  // own username. Before it loads (skeleton / error), only the OWN profile may
  // fall back to the signed-in actor's handle — for another user's profile we
  // must not leak the viewer's handle, so we show an empty header instead.
  const displayUsername = () =>
    profile()?.username || (isOwnProfile() ? actor.username : "");

  // Generation guard: a fast profile→profile navigation must not let a slow
  // prior load overwrite the new one, and the id is captured ONCE so the actor
  // and its posts can't come from two different profiles (split-await mismatch).
  let profileLoadGen = 0;
  const loadProfile = async () => {
    const id = targetActorId();
    const gen = ++profileLoadGen;
    try {
      const profileData = await fetchActor(id);
      if (gen !== profileLoadGen) return;
      setProfile(profileData);
      setIsFollowing(profileData.is_following || false);
      const postsData = await fetchActorPosts(id, {
        limit: PROFILE_POSTS_PAGE,
      });
      if (gen !== profileLoadGen) return;
      setPosts(postsData.posts);
      setPostsCursor(postsData.nextCursor);
      setPostsHasMore(postsData.hasMore);
    } catch (e) {
      if (gen !== profileLoadGen) return;
      console.error("Failed to load profile:", e);
      setError(t("common.error"));
    } finally {
      if (gen === profileLoadGen) setLoading(false);
    }
  };

  // Older posts: page back via the endpoint's composite (published, apId)
  // cursor — a bare published cursor skips posts that share a millisecond.
  const loadMorePosts = async () => {
    const before = postsCursor();
    if (loadingMorePosts() || !postsHasMore() || !before) return;
    setLoadingMorePosts(true);
    try {
      const more = await fetchActorPosts(targetActorId(), {
        limit: PROFILE_POSTS_PAGE,
        before,
      });
      setPosts((prev) => {
        const seen = new Set(prev.map((p) => p.ap_id));
        return [...prev, ...more.posts.filter((p) => !seen.has(p.ap_id))];
      });
      setPostsCursor(more.nextCursor);
      setPostsHasMore(more.hasMore);
    } catch (e) {
      console.error("Failed to load more posts:", e);
      pushToast(setToasts, t("common.loadFailed"), { kind: "error" });
    } finally {
      setLoadingMorePosts(false);
    }
  };

  createEffect(
    on(targetActorId, () => {
      setProfile(null);
      setPosts([]);
      setPostsHasMore(false);
      setIsFollowing(false);
      setFollowPending(false);
      setError(null);
      setLoading(true);
      setShowEditModal(false);
      setShowFollowModal(null);
      setShowMenu(false);
      setShowQr(false);
      setPendingModeration(null);
      setActiveTab("posts");
      setPostsView("list");
      loadProfile();
    }),
  );

  const handleFollow = async () => {
    if (!profile()) return;
    // A follow request that is awaiting approval should not be re-issued.
    if (followPending()) return;
    // In-flight guard: a rapid double-tap would otherwise fire duplicate
    // follow/unfollow requests and drift the optimistic follower_count.
    if (followBusy()) return;
    setFollowBusy(true);
    try {
      if (isFollowing()) {
        await unfollow(profile()!.ap_id);
        setIsFollowing(false);
        setFollowPending(false);
        setProfile((prev) =>
          prev ? { ...prev, follower_count: prev.follower_count - 1 } : null,
        );
        pushToast(setToasts, t("feedback.unfollowed"), { kind: "success" });
      } else {
        const { status } = await follow(profile()!.ap_id);
        // A private/remote follow may land as a pending request that the target
        // still has to approve. Only reflect an accepted follow in the UI; for a
        // pending request keep the follow affordance and do NOT bump the count.
        if (status === "pending") {
          setFollowPending(true);
          pushToast(setToasts, t("profile.followRequested"), {
            kind: "success",
          });
        } else {
          setIsFollowing(true);
          setFollowPending(false);
          setProfile((prev) =>
            prev ? { ...prev, follower_count: prev.follower_count + 1 } : null,
          );
          pushToast(setToasts, t("feedback.followed"), { kind: "success" });
        }
      }
    } catch (e) {
      console.error("Failed to toggle follow:", e);
      pushToast(setToasts, t("feedback.followFailed"), { kind: "error" });
    } finally {
      setFollowBusy(false);
    }
  };

  const handleLike = async (post: Post) => {
    try {
      await toggleLike(post, (fn) => setPosts(fn));
    } catch (e) {
      console.error("Failed to toggle like:", e);
      setError(t("common.error"));
    }
  };

  const openEditModal = () => {
    const p = profile();
    if (p) {
      setEditName(p.name || "");
      setEditSummary(p.summary || "");
      setEditIsPrivate(p.is_private || false);
      setEditIconUrl(p.icon_url || undefined);
      setEditHeaderUrl(p.header_url || undefined);
      setEditFields((p.fields ?? []).map((f) => ({ ...f })));
      setShowEditModal(true);
    }
  };

  const handleSaveProfile = async () => {
    if (saving()) return;
    setSaving(true);
    // Keep only fully-populated label/value pairs; the backend replaces the
    // stored set with this array and caps it at 4.
    const cleanFields = editFields()
      .map((f) => ({ name: f.name.trim(), value: f.value.trim() }))
      .filter((f) => f.name && f.value)
      .slice(0, 4);
    try {
      await updateProfile({
        name: editName().trim() || undefined,
        // Send the (possibly empty) bio verbatim so CLEARING it actually
        // persists: `"" || undefined` would send `undefined`, which the backend
        // skips (PUT /me only updates `summary` when it is present) — the bio
        // would optimistically vanish from the UI but reappear on reload. An
        // empty string makes the backend store null (clears it).
        summary: editSummary().trim(),
        icon_url: editIconUrl() || undefined,
        header_url: editHeaderUrl() || undefined,
        is_private: editIsPrivate(),
        fields: cleanFields,
      });
      setProfile((prev) =>
        prev
          ? {
              ...prev,
              name: editName().trim() || prev.preferred_username,
              summary: editSummary().trim(),
              icon_url: editIconUrl() ?? prev.icon_url,
              header_url: editHeaderUrl() ?? prev.header_url,
              is_private: editIsPrivate(),
              fields: cleanFields,
            }
          : null,
      );
      setShowEditModal(false);
      pushToast(setToasts, t("feedback.settingsSaved"), { kind: "success" });
    } catch (e) {
      console.error("Failed to update profile:", e);
      pushToast(setToasts, t("feedback.settingsFailed"), { kind: "error" });
    } finally {
      setSaving(false);
    }
  };

  const openFollowModal = async (type: "followers" | "following") => {
    setShowFollowModal(type);
    setFollowModalLoading(true);
    setFollowModalActors([]);
    setFollowModalError(null);
    try {
      const data =
        type === "followers"
          ? await fetchFollowers(targetActorId())
          : await fetchFollowing(targetActorId());
      setFollowModalActors(data);
    } catch (e) {
      console.error(`Failed to load ${type}:`, e);
      // Surface the failure instead of letting the modal show a false
      // "no followers yet" empty state.
      setFollowModalError(t("common.loadFailed"));
    } finally {
      setFollowModalLoading(false);
    }
  };

  const confirmModeration = async () => {
    const action = pendingModeration();
    const p = profile();
    setPendingModeration(null);
    if (!action || !p) return;
    try {
      if (action === "block") {
        await blockUser(p.ap_id);
        pushToast(setToasts, t("feedback.blocked"), { kind: "success" });
      } else {
        await muteUser(p.ap_id);
        pushToast(setToasts, t("feedback.muted"), { kind: "success" });
      }
    } catch (e) {
      console.error(`Failed to ${action} user:`, e);
      pushToast(
        setToasts,
        action === "block"
          ? t("feedback.blockFailed")
          : t("feedback.muteFailed"),
        { kind: "error" },
      );
    }
  };

  return (
    <div class="flex flex-col h-full">
      <Show when={error()}>
        <InlineErrorBanner message={error()!} onClose={clearError} />
      </Show>
      <Show when={loading()}>
        <ProfileHeader
          actorId={params.actorId}
          isOwnProfile={isOwnProfile()}
          handle={displayUsername()}
          onOpenQr={() => setShowQr(true)}
        />
        <div class="flex-1 overflow-y-auto">
          <PostSkeleton count={5} />
        </div>
      </Show>

      <Show when={!loading() && !profile()}>
        <ProfileHeader
          actorId={params.actorId}
          isOwnProfile={isOwnProfile()}
          handle={displayUsername()}
          onOpenQr={() => setShowQr(true)}
        />
        <InlineErrorRetry
          message={t("common.loadFailed")}
          retryLabel={t("common.retry")}
          onRetry={loadProfile}
        />
      </Show>

      <Show when={!loading() && profile()}>
        <ProfileHeader
          actorId={params.actorId}
          isOwnProfile={isOwnProfile()}
          handle={profile()!.username}
          onOpenQr={() => setShowQr(true)}
        />
        <div class="flex-1 overflow-y-auto">
          <ProfileSummary
            profile={profile()!}
            isOwnProfile={isOwnProfile()}
            isFollowing={isFollowing()}
            followPending={followPending()}
            showMenu={showMenu()}
            onToggleMenu={() => setShowMenu(!showMenu())}
            onCloseMenu={() => setShowMenu(false)}
            onToggleFollow={handleFollow}
            onOpenEdit={openEditModal}
            onOpenFollowModal={openFollowModal}
            onBlock={() => setPendingModeration("block")}
            onMute={() => setPendingModeration("mute")}
            t={t}
            language={language}
          />
          <ProfilePostsSection
            activeTab={activeTab()}
            onChangeTab={setActiveTab}
            view={postsView()}
            onChangeView={setPostsView}
            posts={posts()}
            actorApId={actor.ap_id}
            onLike={handleLike}
            hasMore={postsHasMore()}
            loadingMore={loadingMorePosts()}
            onLoadMore={loadMorePosts}
            t={t}
          />
        </div>
        <ProfileEditModal
          isOpen={showEditModal()}
          editName={editName()}
          editSummary={editSummary()}
          editIsPrivate={editIsPrivate()}
          editIconUrl={editIconUrl()}
          editHeaderUrl={editHeaderUrl()}
          editFields={editFields()}
          saving={saving()}
          onClose={() => setShowEditModal(false)}
          onSave={handleSaveProfile}
          onChangeName={(event) => setEditName(event.currentTarget.value)}
          onChangeSummary={(event) => setEditSummary(event.currentTarget.value)}
          onTogglePrivate={() => setEditIsPrivate(!editIsPrivate())}
          onChangeIconUrl={setEditIconUrl}
          onChangeHeaderUrl={setEditHeaderUrl}
          onChangeFields={setEditFields}
          t={t}
        />
        <ProfileFollowModal
          type={showFollowModal()}
          actors={followModalActors()}
          loading={followModalLoading()}
          error={followModalError()}
          onRetry={() => {
            const tp = showFollowModal();
            if (tp) void openFollowModal(tp);
          }}
          onClose={() => setShowFollowModal(null)}
          t={t}
        />
      </Show>

      {/* QR / handle-share modal (own profile). Uses the loaded profile when
          available, falling back to the signed-in actor. */}
      <Show when={showQr() && isOwnProfile()}>
        <Suspense>
          <QRCodeModal
            actor={profile() ?? actor}
            onClose={() => setShowQr(false)}
          />
        </Suspense>
      </Show>

      <ConfirmSheet
        open={pendingModeration() !== null}
        title={
          pendingModeration() === "block"
            ? t("confirm.blockTitle")
            : t("confirm.muteTitle")
        }
        body={
          pendingModeration() === "block"
            ? t("confirm.blockBody")
            : t("confirm.muteBody")
        }
        confirmLabel={
          pendingModeration() === "block"
            ? t("profile.block")
            : t("profile.mute")
        }
        destructive={pendingModeration() === "block"}
        onConfirm={confirmModeration}
        onCancel={() => setPendingModeration(null)}
      />
    </div>
  );
}

export default ProfilePage;
