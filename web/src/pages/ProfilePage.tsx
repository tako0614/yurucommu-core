import { useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { atom } from 'jotai';
import { useAtom } from 'jotai';
import { useRequiredActor } from '../hooks/useRequiredActor';
import { Actor, Post } from '../types';
import {
  fetchActor,
  fetchFollowers,
  fetchFollowing,
  follow,
  unfollow,
  likePost,
  unlikePost,
  updateProfile,
  fetchActorPosts,
  fetchAccounts,
  switchAccount,
  AccountInfo,
} from '../lib/api';
import { useI18n } from '../lib/i18n';
import { InlineErrorBanner } from '../components/InlineErrorBanner';
import { ProfileHeader } from '../components/profile/ProfileHeader';
import { ProfileSummary } from '../components/profile/ProfileSummary';
import { ProfilePostsSection } from '../components/profile/ProfilePostsSection';
import { ProfileEditModal } from '../components/profile/ProfileEditModal';
import { ProfileFollowModal } from '../components/profile/ProfileFollowModal';

// Atoms defined at module level
const profile_errorAtom = atom<string | null>(null);
const profile_profileAtom = atom<Actor | null>(null);
const profile_postsAtom = atom<Post[]>([]);
const profile_loadingAtom = atom(true);
const profile_isFollowingAtom = atom(false);
const profile_activeTabAtom = atom<'posts' | 'likes'>('posts');
const profile_showEditModalAtom = atom(false);
const profile_editNameAtom = atom('');
const profile_editSummaryAtom = atom('');
const profile_savingAtom = atom(false);
const profile_showMenuAtom = atom(false);
const profile_showFollowModalAtom = atom<'followers' | 'following' | null>(null);
const profile_editIsPrivateAtom = atom(false);
const profile_followModalActorsAtom = atom<Actor[]>([]);
const profile_followModalLoadingAtom = atom(false);
const profile_showAccountSwitcherAtom = atom(false);
const profile_accountsAtom = atom<AccountInfo[]>([]);
const profile_currentApIdAtom = atom<string>('');
const profile_accountsLoadingAtom = atom(false);

export function ProfilePage() {
  const actor = useRequiredActor();
  const { t } = useI18n();
  const [error, setError] = useAtom(profile_errorAtom);
  const clearError = useCallback(() => setError(null), [setError]);
  const { actorId } = useParams<{ actorId?: string }>();
  const [profile, setProfile] = useAtom(profile_profileAtom);
  const [posts, setPosts] = useAtom(profile_postsAtom);
  const [loading, setLoading] = useAtom(profile_loadingAtom);
  const [isFollowing, setIsFollowing] = useAtom(profile_isFollowingAtom);
  const [activeTab, setActiveTab] = useAtom(profile_activeTabAtom);
  const [showEditModal, setShowEditModal] = useAtom(profile_showEditModalAtom);
  const [editName, setEditName] = useAtom(profile_editNameAtom);
  const [editSummary, setEditSummary] = useAtom(profile_editSummaryAtom);
  const [saving, setSaving] = useAtom(profile_savingAtom);
  const [showMenu, setShowMenu] = useAtom(profile_showMenuAtom);
  const [showFollowModal, setShowFollowModal] = useAtom(profile_showFollowModalAtom);
  const [editIsPrivate, setEditIsPrivate] = useAtom(profile_editIsPrivateAtom);
  const [followModalActors, setFollowModalActors] = useAtom(profile_followModalActorsAtom);
  const [followModalLoading, setFollowModalLoading] = useAtom(profile_followModalLoadingAtom);
  const [showAccountSwitcher, setShowAccountSwitcher] = useAtom(profile_showAccountSwitcherAtom);
  const [accounts, setAccounts] = useAtom(profile_accountsAtom);
  const [currentApId, setCurrentApId] = useAtom(profile_currentApIdAtom);
  const [accountsLoading, setAccountsLoading] = useAtom(profile_accountsLoadingAtom);

  // Use current actor if no actorId in URL
  const targetActorId = actorId ? decodeURIComponent(actorId) : actor.ap_id;
  const isOwnProfile = targetActorId === actor.ap_id;
  const displayUsername = profile?.username || actor.username;

  const loadAccounts = async () => {
    setAccountsLoading(true);
    try {
      const data = await fetchAccounts();
      setAccounts(data.accounts);
      setCurrentApId(data.current_ap_id);
    } catch (e) {
      console.error('Failed to load accounts:', e);
      setError(t('common.error'));
    } finally {
      setAccountsLoading(false);
    }
  };

  const handleSwitchAccount = async (apId: string) => {
    if (apId === currentApId) {
      setShowAccountSwitcher(false);
      return;
    }
    try {
      await switchAccount(apId);
      window.location.reload();
    } catch (e) {
      console.error('Failed to switch account:', e);
      setError(t('common.error'));
    }
  };

  const toggleAccountSwitcher = () => {
    if (!showAccountSwitcher) {
      loadAccounts();
    }
    setShowAccountSwitcher(!showAccountSwitcher);
  };

  const loadProfile = useCallback(async () => {
    try {
      const profileData = await fetchActor(targetActorId);
      setProfile(profileData);
      setIsFollowing(profileData.is_following || false);
      const postsData = await fetchActorPosts(targetActorId);
      setPosts(postsData);
    } catch (e) {
      console.error('Failed to load profile:', e);
      setError(t('common.error'));
    } finally {
      setLoading(false);
    }
  }, [targetActorId, t, setError, setProfile, setIsFollowing, setPosts, setLoading]);

  useEffect(() => {
    setProfile(null);
    setPosts([]);
    setIsFollowing(false);
    setError(null);
    setLoading(true);
    setShowEditModal(false);
    setShowFollowModal(null);
    setShowMenu(false);
    setActiveTab('posts');
    loadProfile();
  }, [loadProfile]);

  const handleFollow = async () => {
    if (!profile) return;
    try {
      if (isFollowing) {
        await unfollow(profile.ap_id);
        setIsFollowing(false);
        setProfile(prev => prev ? { ...prev, follower_count: prev.follower_count - 1 } : null);
      } else {
        await follow(profile.ap_id);
        setIsFollowing(true);
        setProfile(prev => prev ? { ...prev, follower_count: prev.follower_count + 1 } : null);
      }
    } catch (e) {
      console.error('Failed to toggle follow:', e);
      setError(t('common.error'));
    }
  };

  const handleLike = async (post: Post) => {
    try {
      if (post.liked) {
        await unlikePost(post.ap_id);
        setPosts(prev => prev.map(p => p.ap_id === post.ap_id ? { ...p, liked: false, like_count: p.like_count - 1 } : p));
      } else {
        await likePost(post.ap_id);
        setPosts(prev => prev.map(p => p.ap_id === post.ap_id ? { ...p, liked: true, like_count: p.like_count + 1 } : p));
      }
    } catch (e) {
      console.error('Failed to toggle like:', e);
      setError(t('common.error'));
    }
  };

  const openEditModal = () => {
    if (profile) {
      setEditName(profile.name || '');
      setEditSummary(profile.summary || '');
      setEditIsPrivate(profile.is_private || false);
      setShowEditModal(true);
    }
  };

  const handleSaveProfile = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await updateProfile({
        name: editName.trim() || undefined,
        summary: editSummary.trim() || undefined,
        is_private: editIsPrivate,
      });
      setProfile(prev => prev ? {
        ...prev,
        name: editName.trim() || prev.preferred_username,
        summary: editSummary.trim(),
        is_private: editIsPrivate,
      } : null);
      setShowEditModal(false);
    } catch (e) {
      console.error('Failed to update profile:', e);
      setError(t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const openFollowModal = async (type: 'followers' | 'following') => {
    setShowFollowModal(type);
    setFollowModalLoading(true);
    setFollowModalActors([]);
    try {
      const data = type === 'followers'
        ? await fetchFollowers(targetActorId)
        : await fetchFollowing(targetActorId);
      setFollowModalActors(data);
    } catch (e) {
      console.error(`Failed to load ${type}:`, e);
    } finally {
      setFollowModalLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col h-full">
        {error && (
          <InlineErrorBanner message={error} onClose={clearError} />
        )}
        <ProfileHeader
          actorId={actorId}
          isOwnProfile={isOwnProfile}
          username={displayUsername}
          showAccountSwitcher={showAccountSwitcher}
          onToggleAccountSwitcher={toggleAccountSwitcher}
          onCloseAccountSwitcher={() => setShowAccountSwitcher(false)}
          accounts={accounts}
          accountsLoading={accountsLoading}
          currentApId={currentApId}
          onSwitchAccount={handleSwitchAccount}
        />
        <div className="p-8 text-center text-neutral-500">{t('common.loading')}</div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex flex-col h-full">
        {error && (
          <InlineErrorBanner message={error} onClose={clearError} />
        )}
        <ProfileHeader
          actorId={actorId}
          isOwnProfile={isOwnProfile}
          username={displayUsername}
          showAccountSwitcher={showAccountSwitcher}
          onToggleAccountSwitcher={toggleAccountSwitcher}
          onCloseAccountSwitcher={() => setShowAccountSwitcher(false)}
          accounts={accounts}
          accountsLoading={accountsLoading}
          currentApId={currentApId}
          onSwitchAccount={handleSwitchAccount}
        />
        <div className="p-8 text-center text-neutral-500">{t('common.error')}</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {error && (
        <InlineErrorBanner message={error} onClose={clearError} />
      )}
      <ProfileHeader
        actorId={actorId}
        isOwnProfile={isOwnProfile}
        username={profile.username}
        showAccountSwitcher={showAccountSwitcher}
        onToggleAccountSwitcher={toggleAccountSwitcher}
        onCloseAccountSwitcher={() => setShowAccountSwitcher(false)}
        accounts={accounts}
        accountsLoading={accountsLoading}
        currentApId={currentApId}
        onSwitchAccount={handleSwitchAccount}
      />
      <div className="flex-1 overflow-y-auto">
        <ProfileSummary
          profile={profile}
          isOwnProfile={isOwnProfile}
          isFollowing={isFollowing}
          showMenu={showMenu}
          onToggleMenu={() => setShowMenu(!showMenu)}
          onCloseMenu={() => setShowMenu(false)}
          onToggleFollow={handleFollow}
          onOpenEdit={openEditModal}
          onOpenFollowModal={openFollowModal}
          t={t}
        />
        <ProfilePostsSection
          activeTab={activeTab}
          onChangeTab={setActiveTab}
          posts={posts}
          actorApId={actor.ap_id}
          onLike={handleLike}
          t={t}
        />
      </div>
      <ProfileEditModal
        isOpen={showEditModal}
        editName={editName}
        editSummary={editSummary}
        editIsPrivate={editIsPrivate}
        saving={saving}
        onClose={() => setShowEditModal(false)}
        onSave={handleSaveProfile}
        onChangeName={(event) => setEditName(event.target.value)}
        onChangeSummary={(event) => setEditSummary(event.target.value)}
        onTogglePrivate={() => setEditIsPrivate(!editIsPrivate)}
        t={t}
      />
      <ProfileFollowModal
        type={showFollowModal}
        actors={followModalActors}
        loading={followModalLoading}
        onClose={() => setShowFollowModal(null)}
        t={t}
      />
    </div>
  );
}

export default ProfilePage;

