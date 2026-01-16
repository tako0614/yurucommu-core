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
  uploadMedia,
} from '../lib/api';
import { useI18n } from '../lib/i18n';
import { UserAvatar } from '../components/UserAvatar';

interface CommunityProfilePageProps {
  actor: Actor;
}

const BackIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
  </svg>
);

const UsersIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
  </svg>
);

const ChatIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
  </svg>
);

const CalendarIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
  </svg>
);

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
    } finally {
      setCreatingInvite(false);
    }
  };

  const formatJoinDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
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
      await updateCommunitySettings(community.name, settingsForm);
      // Update local community state
      setCommunity(prev => prev ? {
        ...prev,
        display_name: settingsForm.display_name || prev.display_name,
        summary: settingsForm.summary || prev.summary,
        icon_url: settingsForm.icon_url || prev.icon_url,
        visibility: settingsForm.visibility || prev.visibility,
        join_policy: settingsForm.join_policy || prev.join_policy,
        post_policy: settingsForm.post_policy || prev.post_policy,
      } : null);
      setIconPreview(null); // Clear preview after successful save
    } catch (e) {
      setSettingsError('Failed to save settings');
    } finally {
      setSavingSettings(false);
    }
  };

  const canManage = community?.member_role === 'owner' || community?.member_role === 'moderator';

  if (loading) {
    return (
      <div className="flex flex-col h-full">
        <header className="sticky top-0 bg-black/80 backdrop-blur-sm border-b border-neutral-900 z-10">
          <div className="flex items-center gap-4 px-4 py-3">
            <button onClick={() => navigate(-1)} className="p-2 -ml-2 hover:bg-neutral-900 rounded-full">
              <BackIcon />
            </button>
            <h1 className="text-xl font-bold">グループ</h1>
          </div>
        </header>
        <div className="p-8 text-center text-neutral-500">{t('common.loading')}</div>
      </div>
    );
  }

  if (!community) {
    return (
      <div className="flex flex-col h-full">
        <header className="sticky top-0 bg-black/80 backdrop-blur-sm border-b border-neutral-900 z-10">
          <div className="flex items-center gap-4 px-4 py-3">
            <button onClick={() => navigate(-1)} className="p-2 -ml-2 hover:bg-neutral-900 rounded-full">
              <BackIcon />
            </button>
            <h1 className="text-xl font-bold">グループ</h1>
          </div>
        </header>
        <div className="p-8 text-center text-neutral-500">グループが見つかりません</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="sticky top-0 bg-black/80 backdrop-blur-sm border-b border-neutral-900 z-10">
        <div className="flex items-center gap-4 px-4 py-3">
          <button onClick={() => navigate(-1)} className="p-2 -ml-2 hover:bg-neutral-900 rounded-full">
            <BackIcon />
          </button>
          <div>
            <h1 className="text-xl font-bold">{community.display_name || community.name}</h1>
            <p className="text-sm text-neutral-500">{community.member_count} メンバー</p>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        {/* Header Image */}
        <div className="h-32 md:h-48 bg-gradient-to-br from-blue-600 to-purple-700 relative" />

        {/* Profile Info */}
        <div className="px-4 pb-4 relative">
          {/* Icon */}
          <div className="absolute -top-16 left-4">
            <div className="w-32 h-32 rounded-2xl border-4 border-black overflow-hidden bg-neutral-800 flex items-center justify-center">
              {community.icon_url ? (
                <img src={community.icon_url} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="text-4xl font-bold text-white">
                  {(community.display_name || community.name).charAt(0).toUpperCase()}
                </span>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end pt-3 pb-12 gap-2">
            {community.is_member ? (
              <>
                <Link
                  to={`/groups/${community.name}/chat`}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-full font-bold transition-colors"
                >
                  <ChatIcon />
                  <span>トーク</span>
                </Link>
                <button
                  onClick={handleLeave}
                  disabled={joining}
                  className="px-4 py-2 border border-neutral-600 text-white hover:border-red-500 hover:text-red-500 rounded-full font-bold transition-colors disabled:opacity-50"
                >
                  退出
                </button>
              </>
            ) : (
              <button
                onClick={handleJoin}
                disabled={joining || community.join_status === 'pending'}
                className="px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-full font-bold transition-colors disabled:opacity-50"
              >
                {joining
                  ? '参加中...'
                  : community.join_status === 'pending'
                    ? '承認待ち'
                    : community.join_policy === 'invite'
                      ? '招待コードで参加'
                      : '参加する'}
              </button>
            )}
          </div>

          {/* Name */}
          <div className="mb-3">
            <div className="text-xl font-bold text-white">
              {community.display_name || community.name}
            </div>
            <div className="text-neutral-500">@{community.name}</div>
          </div>

          {/* Summary */}
          {community.summary && (
            <p className="text-neutral-200 mb-3 whitespace-pre-wrap">{community.summary}</p>
          )}

          {/* Meta Info */}
          <div className="flex flex-wrap gap-4 text-neutral-500 text-sm mb-3">
            <div className="flex items-center gap-1">
              <UsersIcon />
              <span>{community.member_count} メンバー</span>
            </div>
            <div className="flex items-center gap-1">
              <CalendarIcon />
              <span>作成日 {formatJoinDate(community.created_at)}</span>
            </div>
          </div>

          {/* Visibility & Policy */}
          <div className="flex flex-wrap gap-2">
            <span className={`px-2 py-1 text-xs rounded-full ${
              community.visibility === 'public' ? 'bg-green-500/20 text-green-400' : 'bg-neutral-700 text-neutral-300'
            }`}>
              {community.visibility === 'public' ? '公開' : '非公開'}
            </span>
            <span className="px-2 py-1 text-xs rounded-full bg-neutral-700 text-neutral-300">
              {community.join_policy === 'open' ? '誰でも参加可能' : community.join_policy === 'approval' ? '承認制' : '招待制'}
            </span>
          </div>
        </div>

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
                説明はありません
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
                公開設定
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
                    <div className="text-sm text-neutral-500">メンバーのみがグループの内容を見ることができます</div>
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
