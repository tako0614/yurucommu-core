import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
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
import { UserAvatar } from '../components/UserAvatar';
import { InlineErrorBanner } from '../components/InlineErrorBanner';
import { useInlineError } from '../hooks/useInlineError';
import { CommunityProfileHeader } from '../components/community/CommunityProfileHeader';
import { CommunityProfileSummary } from '../components/community/CommunityProfileSummary';

interface CommunityProfilePageProps {
  actor: Actor;
}

interface Member {
  ap_id: string;
  username: string;
  preferred_username: string;
  name: string | null;
  icon_url: string | null;
  role: string;
  joined_at: string;
}

export function CommunityProfilePage({ actor }: CommunityProfilePageProps) {
  const { t } = useI18n();
  const { error, setError, clearError } = useInlineError();
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const [community, setCommunity] = useState<CommunityDetail | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
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

  const handleUpdateMemberRole = async (member: Member, role: 'owner' | 'moderator' | 'member') => {
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
      setIconPreview(null); // Clear preview after successful save
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
        {activeTab === 'about' && (
          <div className="p-4">
            {community.summary ? (
              <div>
                <h3 className="text-lg font-bold mb-2">グループについて</h3>
                <p className="text-neutral-300 whitespace-pre-wrap">{community.summary}</p>
              </div>
            ) : (
              <div className="text-neutral-500 text-center py-8">
                説明がありません
              </div>
            )}
          </div>
        )}

        {activeTab === 'members' && (
          <div>
            {canManage && (
              <div className="border-b border-neutral-900">
                <div className="px-4 py-3">
                  <div className="text-sm font-semibold text-neutral-400">Join Requests</div>
                </div>
                {loadingRequests ? (
                  <div className="px-4 pb-4 text-sm text-neutral-500">Loading...</div>
                ) : joinRequests.length === 0 ? (
                  <div className="px-4 pb-4 text-sm text-neutral-500">No pending requests</div>
                ) : (
                  joinRequests.map(request => (
                    <div
                      key={request.ap_id}
                      className="flex items-center gap-3 px-4 py-3 border-t border-neutral-900"
                    >
                      <UserAvatar
                        avatarUrl={request.icon_url}
                        name={request.name || request.preferred_username}
                        size={40}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-white truncate">
                          {request.name || request.preferred_username}
                        </div>
                        <div className="text-sm text-neutral-500 truncate">@{request.username}</div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleAcceptRequest(request)}
                          disabled={requestAction[request.ap_id]}
                          className="px-3 py-1 text-xs bg-blue-500 text-white rounded-full hover:bg-blue-600 transition-colors disabled:opacity-50"
                        >
                          Accept
                        </button>
                        <button
                          onClick={() => handleRejectRequest(request)}
                          disabled={requestAction[request.ap_id]}
                          className="px-3 py-1 text-xs bg-neutral-800 text-neutral-200 rounded-full hover:bg-neutral-700 transition-colors disabled:opacity-50"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
            {memberActionError && (
              <div className="px-4 py-2 text-sm text-red-400 bg-red-500/10">
                {memberActionError}
              </div>
            )}
            {members.length === 0 ? (
              <div className="p-8 text-center text-neutral-500">メンバーがいません</div>
            ) : (
              members.map(member => (
                <Link
                  key={member.ap_id}
                  to={`/profile/${encodeURIComponent(member.ap_id)}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-neutral-900/30 transition-colors"
                >
                  <UserAvatar
                    avatarUrl={member.icon_url}
                    name={member.name || member.preferred_username}
                    size={48}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-white truncate">
                        {member.name || member.preferred_username}
                      </span>
                      {member.role === 'owner' && (
                        <span className="px-1.5 py-0.5 text-xs bg-yellow-500/20 text-yellow-400 rounded">
                          オーナー
                        </span>
                      )}
                      {member.role === 'moderator' && (
                        <span className="px-1.5 py-0.5 text-xs bg-blue-500/20 text-blue-400 rounded">
                          モデレーター
                        </span>
                      )}
                    </div>
                    <div className="text-neutral-500 truncate">@{member.username}</div>
                  </div>
                  {isOwner && member.ap_id !== actor.ap_id && (
                    <select
                      value={member.role}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onChange={(e) => handleUpdateMemberRole(member, e.target.value as 'owner' | 'moderator' | 'member')}
                      disabled={updatingMemberRole[member.ap_id]}
                      className="ml-auto bg-neutral-900 border border-neutral-700 text-xs text-white rounded-lg px-2 py-1"
                    >
                      <option value="member">{t('members.member')}</option>
                      <option value="moderator">{t('members.moderator')}</option>
                      <option value="owner">{t('members.owner')}</option>
                    </select>
                  )}
                </Link>
              ))
            )}
            {canManage && community.join_policy === 'invite' && (
              <div className="mt-4 p-3 bg-neutral-900/50 rounded-lg">
                <div className="text-sm font-semibold text-neutral-300 mb-2">Invite Code</div>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={handleCreateInvite}
                    disabled={creatingInvite}
                    className="px-3 py-1 text-xs bg-blue-500 text-white rounded-full hover:bg-blue-600 transition-colors disabled:opacity-50"
                  >
                    {creatingInvite ? 'Creating...' : 'Create'}
                  </button>
                  {inviteCode && (
                    <span className="px-2 py-1 text-xs bg-neutral-800 text-neutral-200 rounded">
                      {inviteCode}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'settings' && canManage && (
          <div className="p-4 space-y-6">
            {settingsError && (
              <div className="p-3 bg-red-500/20 border border-red-500 rounded-lg text-red-400 text-sm">
                {settingsError}
              </div>
            )}

            {/* Icon Upload */}
            <div>
              <label className="block text-sm font-semibold text-neutral-300 mb-2">
                アイコン
              </label>
              <div className="flex items-center gap-4">
                <div className="w-20 h-20 rounded-xl overflow-hidden bg-neutral-800 flex items-center justify-center">
                  {iconPreview || community.icon_url ? (
                    <img
                      src={iconPreview || community.icon_url || ''}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-2xl font-bold text-white">
                      {(community.display_name || community.name).charAt(0).toUpperCase()}
                    </span>
                  )}
                </div>
                <label className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg cursor-pointer transition-colors">
                  {uploadingIcon ? 'アップロード中...' : '画像を選択'}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleIconUpload}
                    disabled={uploadingIcon}
                    className="hidden"
                  />
                </label>
              </div>
            </div>

            {/* Display Name */}
            <div>
              <label className="block text-sm font-semibold text-neutral-300 mb-2">
                表示名
              </label>
              <input
                type="text"
                value={settingsForm.display_name || ''}
                onChange={(e) => setSettingsForm(prev => ({ ...prev, display_name: e.target.value }))}
                className="w-full px-3 py-2 bg-neutral-900 border border-neutral-700 rounded-lg text-white placeholder-neutral-500 focus:border-blue-500 focus:outline-none"
                placeholder="グループの表示名"
              />
            </div>

            {/* Summary */}
            <div>
              <label className="block text-sm font-semibold text-neutral-300 mb-2">
                説明
              </label>
              <textarea
                value={settingsForm.summary || ''}
                onChange={(e) => setSettingsForm(prev => ({ ...prev, summary: e.target.value }))}
                rows={4}
                className="w-full px-3 py-2 bg-neutral-900 border border-neutral-700 rounded-lg text-white placeholder-neutral-500 focus:border-blue-500 focus:outline-none resize-none"
                placeholder="グループの説明"
              />
            </div>

            {/* Visibility */}
            <div>
              <label className="block text-sm font-semibold text-neutral-300 mb-2">
                公開範囲
              </label>
              <div className="space-y-2">
                <label className="flex items-center gap-3 p-3 bg-neutral-900 border border-neutral-700 rounded-lg cursor-pointer hover:border-neutral-600">
                  <input
                    type="radio"
                    name="visibility"
                    checked={settingsForm.visibility === 'public'}
                    onChange={() => setSettingsForm(prev => ({ ...prev, visibility: 'public' }))}
                    className="w-4 h-4 text-blue-500"
                  />
                  <div>
                    <div className="text-white font-medium">公開</div>
                    <div className="text-sm text-neutral-500">誰でもグループを見つけて閲覧できます</div>
                  </div>
                </label>
                <label className="flex items-center gap-3 p-3 bg-neutral-900 border border-neutral-700 rounded-lg cursor-pointer hover:border-neutral-600">
                  <input
                    type="radio"
                    name="visibility"
                    checked={settingsForm.visibility === 'private'}
                    onChange={() => setSettingsForm(prev => ({ ...prev, visibility: 'private' }))}
                    className="w-4 h-4 text-blue-500"
                  />
                  <div>
                    <div className="text-white font-medium">非公開</div>
                    <div className="text-sm text-neutral-500">メンバーのみがグループの内容を閲覧できます</div>
                  </div>
                </label>
              </div>
            </div>

            {/* Join Policy */}
            <div>
              <label className="block text-sm font-semibold text-neutral-300 mb-2">
                参加ポリシー
              </label>
              <div className="space-y-2">
                <label className="flex items-center gap-3 p-3 bg-neutral-900 border border-neutral-700 rounded-lg cursor-pointer hover:border-neutral-600">
                  <input
                    type="radio"
                    name="join_policy"
                    checked={settingsForm.join_policy === 'open'}
                    onChange={() => setSettingsForm(prev => ({ ...prev, join_policy: 'open' }))}
                    className="w-4 h-4 text-blue-500"
                  />
                  <div>
                    <div className="text-white font-medium">オープン</div>
                    <div className="text-sm text-neutral-500">誰でも参加できます</div>
                  </div>
                </label>
                <label className="flex items-center gap-3 p-3 bg-neutral-900 border border-neutral-700 rounded-lg cursor-pointer hover:border-neutral-600">
                  <input
                    type="radio"
                    name="join_policy"
                    checked={settingsForm.join_policy === 'approval'}
                    onChange={() => setSettingsForm(prev => ({ ...prev, join_policy: 'approval' }))}
                    className="w-4 h-4 text-blue-500"
                  />
                  <div>
                    <div className="text-white font-medium">承認制</div>
                    <div className="text-sm text-neutral-500">参加にはオーナーまたはモデレーターの承認が必要です</div>
                  </div>
                </label>
                <label className="flex items-center gap-3 p-3 bg-neutral-900 border border-neutral-700 rounded-lg cursor-pointer hover:border-neutral-600">
                  <input
                    type="radio"
                    name="join_policy"
                    checked={settingsForm.join_policy === 'invite'}
                    onChange={() => setSettingsForm(prev => ({ ...prev, join_policy: 'invite' }))}
                    className="w-4 h-4 text-blue-500"
                  />
                  <div>
                    <div className="text-white font-medium">招待制</div>
                    <div className="text-sm text-neutral-500">招待コードがないと参加できません</div>
                  </div>
                </label>
              </div>
            </div>

            {/* Post Policy */}
            <div>
              <label className="block text-sm font-semibold text-neutral-300 mb-2">
                投稿ポリシー
              </label>
              <div className="space-y-2">
                <label className="flex items-center gap-3 p-3 bg-neutral-900 border border-neutral-700 rounded-lg cursor-pointer hover:border-neutral-600">
                  <input
                    type="radio"
                    name="post_policy"
                    checked={settingsForm.post_policy === 'anyone'}
                    onChange={() => setSettingsForm(prev => ({ ...prev, post_policy: 'anyone' }))}
                    className="w-4 h-4 text-blue-500"
                  />
                  <div>
                    <div className="text-white font-medium">誰でも</div>
                    <div className="text-sm text-neutral-500">誰でも投稿できます</div>
                  </div>
                </label>
                <label className="flex items-center gap-3 p-3 bg-neutral-900 border border-neutral-700 rounded-lg cursor-pointer hover:border-neutral-600">
                  <input
                    type="radio"
                    name="post_policy"
                    checked={settingsForm.post_policy === 'members'}
                    onChange={() => setSettingsForm(prev => ({ ...prev, post_policy: 'members' }))}
                    className="w-4 h-4 text-blue-500"
                  />
                  <div>
                    <div className="text-white font-medium">メンバーのみ</div>
                    <div className="text-sm text-neutral-500">グループメンバーのみが投稿できます</div>
                  </div>
                </label>
                <label className="flex items-center gap-3 p-3 bg-neutral-900 border border-neutral-700 rounded-lg cursor-pointer hover:border-neutral-600">
                  <input
                    type="radio"
                    name="post_policy"
                    checked={settingsForm.post_policy === 'mods'}
                    onChange={() => setSettingsForm(prev => ({ ...prev, post_policy: 'mods' }))}
                    className="w-4 h-4 text-blue-500"
                  />
                  <div>
                    <div className="text-white font-medium">モデレーター以上</div>
                    <div className="text-sm text-neutral-500">モデレーターとオーナーのみが投稿できます</div>
                  </div>
                </label>
                <label className="flex items-center gap-3 p-3 bg-neutral-900 border border-neutral-700 rounded-lg cursor-pointer hover:border-neutral-600">
                  <input
                    type="radio"
                    name="post_policy"
                    checked={settingsForm.post_policy === 'owners'}
                    onChange={() => setSettingsForm(prev => ({ ...prev, post_policy: 'owners' }))}
                    className="w-4 h-4 text-blue-500"
                  />
                  <div>
                    <div className="text-white font-medium">オーナーのみ</div>
                    <div className="text-sm text-neutral-500">オーナーのみが投稿できます</div>
                  </div>
                </label>
              </div>
            </div>

            {/* Save Button */}
            <div className="pt-4">
              <button
                onClick={handleSaveSettings}
                disabled={savingSettings}
                className="w-full px-6 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-full font-bold transition-colors disabled:opacity-50"
              >
                {savingSettings ? '保存中...' : '設定を保存'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}













