import { createEffect, createSignal, on, Show } from "solid-js";
import { useParams } from "@solidjs/router";
import { useRequiredActor } from "../hooks/useRequiredActor.ts";
import { Actor, Post } from "../types/index.ts";
import {
  fetchActor,
  fetchActorPosts,
  fetchFollowers,
  fetchFollowing,
  follow,
  unfollow,
  updateProfile,
} from "../lib/api.ts";
import { toggleLike } from "../atoms/posts.ts";
import { useI18n } from "../lib/i18n.tsx";
import { useSetAtom } from "solid-jotai";
import { pushToast, toastsAtom } from "../atoms/toast.ts";
import { InlineErrorBanner } from "../components/InlineErrorBanner.tsx";
import { ProfileHeader } from "../components/profile/ProfileHeader.tsx";
import { ProfileSummary } from "../components/profile/ProfileSummary.tsx";
import { ProfilePostsSection } from "../components/profile/ProfilePostsSection.tsx";
import { ProfileEditModal } from "../components/profile/ProfileEditModal.tsx";
import { ProfileFollowModal } from "../components/profile/ProfileFollowModal.tsx";
import { QRCodeModal } from "../components/QRCodeModal.tsx";
import { PostSkeleton } from "../components/timeline/PostSkeleton.tsx";

export function ProfilePage() {
  const actor = useRequiredActor();
  const { t } = useI18n();
  const setToasts = useSetAtom(toastsAtom);
  const [error, setError] = createSignal<string | null>(null);
  const clearError = () => setError(null);
  const params = useParams();
  const [profile, setProfile] = createSignal<Actor | null>(null);
  const [posts, setPosts] = createSignal<Post[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [isFollowing, setIsFollowing] = createSignal(false);
  const [activeTab, setActiveTab] = createSignal<"posts" | "likes">("posts");
  // Media grid is the IG-style default; a list toggle is available.
  const [postsView, setPostsView] = createSignal<"grid" | "list">("grid");
  const [showEditModal, setShowEditModal] = createSignal(false);
  const [editName, setEditName] = createSignal("");
  const [editSummary, setEditSummary] = createSignal("");
  const [saving, setSaving] = createSignal(false);
  const [showMenu, setShowMenu] = createSignal(false);
  const [showFollowModal, setShowFollowModal] = createSignal<
    "followers" | "following" | null
  >(null);
  const [editIsPrivate, setEditIsPrivate] = createSignal(false);
  const [followModalActors, setFollowModalActors] = createSignal<Actor[]>([]);
  const [followModalLoading, setFollowModalLoading] = createSignal(false);
  const [showQr, setShowQr] = createSignal(false);

  // Use current actor if no actorId in URL
  const targetActorId = () =>
    params.actorId ? decodeURIComponent(params.actorId) : actor.ap_id;
  const isOwnProfile = () => targetActorId() === actor.ap_id;
  const displayUsername = () => profile()?.username || actor.username;

  const loadProfile = async () => {
    try {
      const profileData = await fetchActor(targetActorId());
      setProfile(profileData);
      setIsFollowing(profileData.is_following || false);
      const postsData = await fetchActorPosts(targetActorId());
      setPosts(postsData);
    } catch (e) {
      console.error("Failed to load profile:", e);
      setError(t("common.error"));
    } finally {
      setLoading(false);
    }
  };

  createEffect(
    on(targetActorId, () => {
      setProfile(null);
      setPosts([]);
      setIsFollowing(false);
      setError(null);
      setLoading(true);
      setShowEditModal(false);
      setShowFollowModal(null);
      setShowMenu(false);
      setShowQr(false);
      setActiveTab("posts");
      setPostsView("grid");
      loadProfile();
    }),
  );

  const handleFollow = async () => {
    if (!profile()) return;
    try {
      if (isFollowing()) {
        await unfollow(profile()!.ap_id);
        setIsFollowing(false);
        setProfile((prev) =>
          prev ? { ...prev, follower_count: prev.follower_count - 1 } : null,
        );
        pushToast(setToasts, t("feedback.unfollowed"), { kind: "success" });
      } else {
        await follow(profile()!.ap_id);
        setIsFollowing(true);
        setProfile((prev) =>
          prev ? { ...prev, follower_count: prev.follower_count + 1 } : null,
        );
        pushToast(setToasts, t("feedback.followed"), { kind: "success" });
      }
    } catch (e) {
      console.error("Failed to toggle follow:", e);
      pushToast(setToasts, t("feedback.followFailed"), { kind: "error" });
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
      setShowEditModal(true);
    }
  };

  const handleSaveProfile = async () => {
    if (saving()) return;
    setSaving(true);
    try {
      await updateProfile({
        name: editName().trim() || undefined,
        summary: editSummary().trim() || undefined,
        is_private: editIsPrivate(),
      });
      setProfile((prev) =>
        prev
          ? {
              ...prev,
              name: editName().trim() || prev.preferred_username,
              summary: editSummary().trim(),
              is_private: editIsPrivate(),
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
    try {
      const data =
        type === "followers"
          ? await fetchFollowers(targetActorId())
          : await fetchFollowing(targetActorId());
      setFollowModalActors(data);
    } catch (e) {
      console.error(`Failed to load ${type}:`, e);
    } finally {
      setFollowModalLoading(false);
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
        <div class="p-8 text-center text-neutral-500">{t("common.error")}</div>
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
            showMenu={showMenu()}
            onToggleMenu={() => setShowMenu(!showMenu())}
            onCloseMenu={() => setShowMenu(false)}
            onToggleFollow={handleFollow}
            onOpenEdit={openEditModal}
            onOpenFollowModal={openFollowModal}
            t={t}
          />
          <ProfilePostsSection
            activeTab={activeTab()}
            onChangeTab={setActiveTab}
            view={postsView()}
            onChangeView={setPostsView}
            posts={posts()}
            actorApId={actor.ap_id}
            onLike={handleLike}
            t={t}
          />
        </div>
        <ProfileEditModal
          isOpen={showEditModal()}
          editName={editName()}
          editSummary={editSummary()}
          editIsPrivate={editIsPrivate()}
          saving={saving()}
          onClose={() => setShowEditModal(false)}
          onSave={handleSaveProfile}
          onChangeName={(event) => setEditName(event.currentTarget.value)}
          onChangeSummary={(event) => setEditSummary(event.currentTarget.value)}
          onTogglePrivate={() => setEditIsPrivate(!editIsPrivate())}
          t={t}
        />
        <ProfileFollowModal
          type={showFollowModal()}
          actors={followModalActors()}
          loading={followModalLoading()}
          onClose={() => setShowFollowModal(null)}
          t={t}
        />
      </Show>

      {/* QR / handle-share modal (own profile). Uses the loaded profile when
          available, falling back to the signed-in actor. */}
      <Show when={showQr() && isOwnProfile()}>
        <QRCodeModal
          actor={profile() ?? actor}
          onClose={() => setShowQr(false)}
        />
      </Show>
    </div>
  );
}

export default ProfilePage;
