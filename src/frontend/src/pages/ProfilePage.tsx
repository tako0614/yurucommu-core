import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
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
import { useInlineError } from '../hooks/useInlineError';
import { ProfileHeader } from '../components/profile/ProfileHeader';
import { ProfileSummary } from '../components/profile/ProfileSummary';
import { ProfilePostsSection } from '../components/profile/ProfilePostsSection';
import { ProfileEditModal } from '../components/profile/ProfileEditModal';
import { ProfileFollowModal } from '../components/profile/ProfileFollowModal';

interface ProfilePageProps {
  actor: Actor;
}

export function ProfilePage({ actor }: ProfilePageProps) {
  const { t } = useI18n();
  const { error, setError, clearError } = useInlineError();
  const { actorId } = useParams<{ actorId?: string }>();
  const [profile, setProfile] = useState<Actor | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFollowing, setIsFollowing] = useState(false);
  const [activeTab, setActiveTab] = useState<'posts' | 'likes'>('posts');
  const [showEditModal, setShowEditModal] = useState(false);
  const [editName, setEditName] = useState('');
  const [editSummary, setEditSummary] = useState('');
  const [saving, setSaving] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showFollowModal, setShowFollowModal] = useState<'followers' | 'following' | null>(null);
  const [editIsPrivate, setEditIsPrivate] = useState(false);
  const [followModalActors, setFollowModalActors] = useState<Actor[]>([]);
  const [followModalLoading, setFollowModalLoading] = useState(false);
  const [showAccountSwitcher, setShowAccountSwitcher] = useState(false);
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);
  const [currentApId, setCurrentApId] = useState<string>('');
  const [accountsLoading, setAccountsLoading] = useState(false);

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
  }, [targetActorId]);

  useEffect(() => {
    setLoading(true);
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
        />
        <ProfilePostsSection
          activeTab={activeTab}
          onChangeTab={setActiveTab}
          posts={posts}
          actorApId={actor.ap_id}
          onLike={handleLike}
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
      />
      <ProfileFollowModal
        type={showFollowModal}
        actors={followModalActors}
        loading={followModalLoading}
        onClose={() => setShowFollowModal(null)}
      />
    </div>
  );
}

