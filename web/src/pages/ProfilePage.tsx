import { createEffect, createSignal, on, onMount, Show } from "solid-js";
import { useParams } from "@solidjs/router";
import { useRequiredActor } from "../hooks/useRequiredActor.ts";
import { Actor, Post } from "../types/index.ts";
import {
  AccountInfo,
  fetchAccounts,
  fetchActor,
  fetchActorPosts,
  fetchFollowers,
  fetchFollowing,
  follow,
  switchAccount,
  unfollow,
  updateProfile,
} from "../lib/api.ts";
import { toggleLike } from "../atoms/posts.ts";
import { useI18n } from "../lib/i18n.tsx";
import { InlineErrorBanner } from "../components/InlineErrorBanner.tsx";
import { ProfileHeader } from "../components/profile/ProfileHeader.tsx";
import { ProfileSummary } from "../components/profile/ProfileSummary.tsx";
import { ProfilePostsSection } from "../components/profile/ProfilePostsSection.tsx";
import { ProfileEditModal } from "../components/profile/ProfileEditModal.tsx";
import { ProfileFollowModal } from "../components/profile/ProfileFollowModal.tsx";

export function ProfilePage() {
  const actor = useRequiredActor();
  const { t } = useI18n();
  const [error, setError] = createSignal<string | null>(null);
  const clearError = () => setError(null);
  const params = useParams();
  const [profile, setProfile] = createSignal<Actor | null>(null);
  const [posts, setPosts] = createSignal<Post[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [isFollowing, setIsFollowing] = createSignal(false);
  const [activeTab, setActiveTab] = createSignal<"posts" | "likes">("posts");
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
  const [showAccountSwitcher, setShowAccountSwitcher] = createSignal(false);
  const [accounts, setAccounts] = createSignal<AccountInfo[]>([]);
  const [currentApId, setCurrentApId] = createSignal<string>("");
  const [accountsLoading, setAccountsLoading] = createSignal(false);

  // Use current actor if no actorId in URL
  const targetActorId = () =>
    params.actorId ? decodeURIComponent(params.actorId) : actor.ap_id;
  const isOwnProfile = () => targetActorId() === actor.ap_id;
  const displayUsername = () => profile()?.username || actor.username;

  const loadAccounts = async () => {
    setAccountsLoading(true);
    try {
      const data = await fetchAccounts();
      setAccounts(data.accounts);
      setCurrentApId(data.current_ap_id);
    } catch (e) {
      console.error("Failed to load accounts:", e);
      setError(t("common.error"));
    } finally {
      setAccountsLoading(false);
    }
  };

  const handleSwitchAccount = async (apId: string) => {
    if (apId === currentApId()) {
      setShowAccountSwitcher(false);
      return;
    }
    try {
      await switchAccount(apId);
      window.location.reload();
    } catch (e) {
      console.error("Failed to switch account:", e);
      setError(t("common.error"));
    }
  };

  const toggleAccountSwitcher = () => {
    if (!showAccountSwitcher()) {
      loadAccounts();
    }
    setShowAccountSwitcher(!showAccountSwitcher());
  };

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
      setActiveTab("posts");
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
      } else {
        await follow(profile()!.ap_id);
        setIsFollowing(true);
        setProfile((prev) =>
          prev ? { ...prev, follower_count: prev.follower_count + 1 } : null,
        );
      }
    } catch (e) {
      console.error("Failed to toggle follow:", e);
      setError(t("common.error"));
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
    } catch (e) {
      console.error("Failed to update profile:", e);
      setError(t("common.error"));
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
          username={displayUsername()}
          showAccountSwitcher={showAccountSwitcher()}
          onToggleAccountSwitcher={toggleAccountSwitcher}
          onCloseAccountSwitcher={() => setShowAccountSwitcher(false)}
          accounts={accounts()}
          accountsLoading={accountsLoading()}
          currentApId={currentApId()}
          onSwitchAccount={handleSwitchAccount}
        />
        <div class="p-8 text-center text-neutral-500">
          {t("common.loading")}
        </div>
      </Show>

      <Show when={!loading() && !profile()}>
        <ProfileHeader
          actorId={params.actorId}
          isOwnProfile={isOwnProfile()}
          username={displayUsername()}
          showAccountSwitcher={showAccountSwitcher()}
          onToggleAccountSwitcher={toggleAccountSwitcher}
          onCloseAccountSwitcher={() => setShowAccountSwitcher(false)}
          accounts={accounts()}
          accountsLoading={accountsLoading()}
          currentApId={currentApId()}
          onSwitchAccount={handleSwitchAccount}
        />
        <div class="p-8 text-center text-neutral-500">{t("common.error")}</div>
      </Show>

      <Show when={!loading() && profile()}>
        <ProfileHeader
          actorId={params.actorId}
          isOwnProfile={isOwnProfile()}
          username={profile()!.username}
          showAccountSwitcher={showAccountSwitcher()}
          onToggleAccountSwitcher={toggleAccountSwitcher}
          onCloseAccountSwitcher={() => setShowAccountSwitcher(false)}
          accounts={accounts()}
          accountsLoading={accountsLoading()}
          currentApId={currentApId()}
          onSwitchAccount={handleSwitchAccount}
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
    </div>
  );
}

export default ProfilePage;
