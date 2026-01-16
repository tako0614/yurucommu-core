import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Actor } from '../types';
import {
  CommunityDetail,
  fetchCommunity,
  joinCommunity,
  leaveCommunity,
  fetchCommunityMembers,
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
  const [activeTab, setActiveTab] = useState<'about' | 'members'>('about');
  const [joining, setJoining] = useState(false);

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
      await joinCommunity(community.name);
      setCommunity(prev => prev ? { ...prev, is_member: true, member_count: prev.member_count + 1 } : null);
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

  const formatJoinDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
  };

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
                disabled={joining}
                className="px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-full font-bold transition-colors disabled:opacity-50"
              >
                {joining ? '参加中...' : '参加する'}
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
          </div>
        )}
      </div>
    </div>
  );
}
