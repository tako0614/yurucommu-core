import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Actor } from '../types';
import {
  CommunityDetail,
  CommunityJoinRequest,
  CommunitySettings,
  fetchCommunity,
  joinCommunity,
  leaveCommunity,
  fetchCommunityMembers,
  fetchCommunityJoinRequests,
  acceptCommunityJoinRequest,
  rejectCommunityJoinRequest,
  createCommunityInvite,
  updateCommunitySettings,
  updateCommunityMemberRole,
  uploadMedia,
} from '../lib/api';
import { useI18n } from '../lib/i18n';
import { InlineErrorBanner } from '../components/InlineErrorBanner';
import { useInlineError } from '../hooks/useInlineError';
import { CommunityProfileHeader } from '../components/community/CommunityProfileHeader';
import { CommunityProfileSummary } from '../components/community/CommunityProfileSummary';
import { CommunityAboutPanel } from '../components/community/CommunityAboutPanel';
import { CommunityMembersPanel } from '../components/community/CommunityMembersPanel';
import { CommunitySettingsPanel } from '../components/community/CommunitySettingsPanel';
import type { CommunityMember } from '../components/community/types';

interface CommunityProfilePageProps {
  actor: Actor;
}

export function CommunityProfilePage({ actor }: CommunityProfilePageProps) {
  const { t } = useI18n();
  const { error, setError, clearError } = useInlineError();
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const [community, setCommunity] = useState<CommunityDetail | null>(null);
  const [members, setMembers] = useState<CommunityMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'about' | 'members' | 'settings'>('about');
  const [joining, setJoining] = useState(false);
  const [joinRequests, setJoinRequests] = useState<CommunityJoinRequest[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [requestAction, setRequestAction] = useState<Record<string, boolean>>({});
  const [memberActionError, setMemberActionError] = useState<string | null>(null);
  const [updatingMemberRole, setUpdatingMemberRole] = useState<Record<string, boolean>>({});
  // Settings state
  const [settingsForm, setSettingsForm] = useState<CommunitySettings>({});
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [uploadingIcon, setUploadingIcon] = useState(false);
  const [iconPreview, setIconPreview] = useState<string | null>(null);

  // Cleanup iconPreview ObjectURL on unmount
  useEffect(() => {
    return () => {
      if (iconPreview) {
        URL.revokeObjectURL(iconPreview);
      }
    };
  }, [iconPreview]);

  useEffect(() => {
    if (name) {
      loadCommunity();
    }
  }, [name]);

  const loadCommunity = async () => {
    if (!name) return;
    setLoading(true);
    try {
      const data = await fetchCommunity(name);
      setCommunity(data);
      const membersData = await fetchCommunityMembers(name);
      setMembers(membersData);
      const canManage = data.member_role === 'owner' || data.member_role === 'moderator';
      if (canManage) {
        setLoadingRequests(true);
        try {
          const requestsData = await fetchCommunityJoinRequests(name);
          setJoinRequests(requestsData);
        } finally {
          setLoadingRequests(false);
        }
      } else {
        setJoinRequests([]);
      }
    } catch (e) {
      console.error('Failed to load community:', e);
      setError(t('common.error'));
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = async () => {
    if (!community || joining) return;
    setJoining(true);
    try {
      let inviteId: string | undefined;
      if (community.join_policy === 'invite') {
        const input = window.prompt('Invite code');
        if (!input) {
          setJoining(false);
          return;
        }
        inviteId = input.trim();
      }
      const result = await joinCommunity(community.name, { inviteId });
      if (result.status === 'pending') {
        setCommunity(prev => prev ? { ...prev, join_status: 'pending' } : null);
      } else {
        setCommunity(prev => prev ? { ...prev, is_member: true, join_status: null, member_count: prev.member_count + 1 } : null);
      }
    } catch (e) {
      console.error('Failed to join:', e);
      setError(t('common.error'));
    } finally {
      setJoining(false);
    }
  };

  const handleLeave = async () => {
    if (!community || joining) return;
    setJoining(true);
    try {
      await leaveCommunity(community.name);
      setCommunity(prev => prev ? { ...prev, is_member: false, member_count: prev.member_count - 1 } : null);
    } catch (e) {
      console.error('Failed to leave:', e);
      setError(t('common.error'));
    } finally {
      setJoining(false);
    }
  };

  const handleAcceptRequest = async (request: CommunityJoinRequest) => {
    if (!community) return;
    if (requestAction[request.ap_id]) return;
    setRequestAction(prev => ({ ...prev, [request.ap_id]: true }));
    try {
      await acceptCommunityJoinRequest(community.name, request.ap_id);
      setJoinRequests(prev => prev.filter(r => r.ap_id !== request.ap_id));
      const membersData = await fetchCommunityMembers(community.name);
      setMembers(membersData);
      setCommunity(prev => prev ? { ...prev, member_count: prev.member_count + 1 } : null);
    } catch (e) {
      console.error('Failed to accept join request:', e);
      setError(t('common.error'));
    } finally {
      setRequestAction(prev => ({ ...prev, [request.ap_id]: false }));
    }
  };

  const handleRejectRequest = async (request: CommunityJoinRequest) => {
    if (!community) return;
    if (requestAction[request.ap_id]) return;
    setRequestAction(prev => ({ ...prev, [request.ap_id]: true }));
    try {
      await rejectCommunityJoinRequest(community.name, request.ap_id);
      setJoinRequests(prev => prev.filter(r => r.ap_id !== request.ap_id));
    } catch (e) {
      console.error('Failed to reject join request:', e);
      setError(t('common.error'));
    } finally {
      setRequestAction(prev => ({ ...prev, [request.ap_id]: false }));
    }
  };

  const handleCreateInvite = async () => {
    if (!community || creatingInvite) return;
    setCreatingInvite(true);
    try {
      const result = await createCommunityInvite(community.name);
      setInviteCode(result.invite_id);
    } catch (e) {
      console.error('Failed to create invite:', e);
      setError(t('common.error'));
    } finally {
      setCreatingInvite(false);
    }
  };

  const handleUpdateMemberRole = async (member: CommunityMember, role: 'owner' | 'moderator' | 'member') => {
    if (!community) return;
    if (member.role === role || updatingMemberRole[member.ap_id]) return;
    setMemberActionError(null);
    setUpdatingMemberRole(prev => ({ ...prev, [member.ap_id]: true }));
    try {
      await updateCommunityMemberRole(community.name, member.ap_id, role);
      setMembers(prev =>
        prev.map(m => (m.ap_id === member.ap_id ? { ...m, role } : m))
      );
      if (member.ap_id === actor.ap_id) {
        setCommunity(prev => prev ? { ...prev, member_role: role } : prev);
      }
    } catch (e) {
      console.error('Failed to update member role:', e);
      setMemberActionError(t('common.error'));
    } finally {
      setUpdatingMemberRole(prev => ({ ...prev, [member.ap_id]: false }));
    }
  };

  // Initialize settings form when community is loaded
  useEffect(() => {
    if (community) {
      setSettingsForm({
        display_name: community.display_name || community.name,
        summary: community.summary || '',
        visibility: community.visibility as 'public' | 'private',
        join_policy: community.join_policy as 'open' | 'approval' | 'invite',
        post_policy: community.post_policy as 'anyone' | 'members' | 'mods' | 'owners',
      });
    }
  }, [community]);

  const handleIconUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || uploadingIcon) return;

    setUploadingIcon(true);
    try {
      const result = await uploadMedia(file);
      setSettingsForm(prev => ({ ...prev, icon_url: result.url }));
      // Revoke old ObjectURL before creating a new one
      if (iconPreview) {
        URL.revokeObjectURL(iconPreview);
      }
      setIconPreview(URL.createObjectURL(file));
    } catch (err) {
      setSettingsError('アイコンのアップロードに失敗しました');
    } finally {
      setUploadingIcon(false);
    }
  };

  const handleSaveSettings = async () => {
    if (!community || savingSettings) return;
    setSavingSettings(true);
    setSettingsError(null);
    try {
      const normalizedSettings: CommunitySettings = {
        ...settingsForm,
        display_name: settingsForm.display_name !== undefined ? settingsForm.display_name.trim() : undefined,
        summary: settingsForm.summary !== undefined ? settingsForm.summary.trim() : undefined,
      };
      await updateCommunitySettings(community.name, normalizedSettings);
      // Update local community state
      setCommunity(prev => prev ? {
        ...prev,
        display_name: normalizedSettings.display_name ?? prev.display_name,
        summary: normalizedSettings.summary ?? prev.summary,
        icon_url: normalizedSettings.icon_url ?? prev.icon_url,
        visibility: normalizedSettings.visibility ?? prev.visibility,
        join_policy: normalizedSettings.join_policy ?? prev.join_policy,
        post_policy: normalizedSettings.post_policy ?? prev.post_policy,
      } : null);
      // Cleanup ObjectURL and clear preview after successful save
      if (iconPreview) {
        URL.revokeObjectURL(iconPreview);
      }
      setIconPreview(null);
    } catch (e) {
      setSettingsError('Failed to save settings');
    } finally {
      setSavingSettings(false);
    }
  };

  const canManage = community?.member_role === 'owner' || community?.member_role === 'moderator';
  const isOwner = community?.member_role === 'owner';

  if (loading) {
    return (
      <div className="flex flex-col h-full">
        {error && (
          <InlineErrorBanner message={error} onClose={clearError} />
        )}
        <CommunityProfileHeader
          title={t('groups.title')}
          subtitle=""
          onBack={() => navigate(-1)}
        />
        <div className="p-8 text-center text-neutral-500">{t('common.loading')}</div>
      </div>
    );
  }

  if (!community) {
    return (
      <div className="flex flex-col h-full">
        {error && (
          <InlineErrorBanner message={error} onClose={clearError} />
        )}
        <CommunityProfileHeader
          title={t('groups.title')}
          subtitle=""
          onBack={() => navigate(-1)}
        />
        <div className="p-8 text-center text-neutral-500">グループが見つかりません</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {error && (
        <InlineErrorBanner message={error} onClose={clearError} />
      )}
      <CommunityProfileHeader
        title={community.display_name || community.name}
        subtitle={`${community.member_count} メンバー`}
        onBack={() => navigate(-1)}
      />

      <div className="flex-1 overflow-y-auto">
        <CommunityProfileSummary
          community={community}
          joining={joining}
          onJoin={handleJoin}
          onLeave={handleLeave}
          chatPath={`/groups/${community.name}/chat`}
        />
        {/* Tabs */}
        <div className="border-b border-neutral-900 flex">
          <button
            onClick={() => setActiveTab('about')}
            className={`flex-1 py-4 text-center font-bold transition-colors relative ${
              activeTab === 'about' ? 'text-white' : 'text-neutral-500 hover:bg-neutral-900/50'
            }`}
          >
            概要
            {activeTab === 'about' && (
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-16 h-1 bg-blue-500 rounded-full" />
            )}
          </button>
          <button
            onClick={() => setActiveTab('members')}
            className={`flex-1 py-4 text-center font-bold transition-colors relative ${
              activeTab === 'members' ? 'text-white' : 'text-neutral-500 hover:bg-neutral-900/50'
            }`}
          >
            メンバー
            {activeTab === 'members' && (
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-16 h-1 bg-blue-500 rounded-full" />
            )}
          </button>
          {canManage && (
            <button
              onClick={() => setActiveTab('settings')}
              className={`flex-1 py-4 text-center font-bold transition-colors relative ${
                activeTab === 'settings' ? 'text-white' : 'text-neutral-500 hover:bg-neutral-900/50'
              }`}
            >
              設定
              {activeTab === 'settings' && (
                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-16 h-1 bg-blue-500 rounded-full" />
              )}
            </button>
          )}
        </div>

        {/* Content */}
        {activeTab === 'about' && <CommunityAboutPanel community={community} />}
        {activeTab === 'members' && (
          <CommunityMembersPanel
            members={members}
            joinRequests={joinRequests}
            canManage={canManage}
            isOwner={isOwner}
            loadingRequests={loadingRequests}
            requestAction={requestAction}
            memberActionError={memberActionError}
            updatingMemberRole={updatingMemberRole}
            inviteCode={inviteCode}
            creatingInvite={creatingInvite}
            joinPolicy={community.join_policy}
            actorApId={actor.ap_id}
            onAcceptRequest={handleAcceptRequest}
            onRejectRequest={handleRejectRequest}
            onUpdateMemberRole={handleUpdateMemberRole}
            onCreateInvite={handleCreateInvite}
            t={t}
          />
        )}
        {activeTab === 'settings' && canManage && (
          <CommunitySettingsPanel
            community={community}
            settingsForm={settingsForm}
            settingsError={settingsError}
            savingSettings={savingSettings}
            uploadingIcon={uploadingIcon}
            iconPreview={iconPreview}
            onChangeSettings={(updater) => setSettingsForm((prev) => updater(prev))}
            onUploadIcon={handleIconUpload}
            onSaveSettings={handleSaveSettings}
          />
        )}
      </div>
    </div>
  );
}

export default CommunityProfilePage;
