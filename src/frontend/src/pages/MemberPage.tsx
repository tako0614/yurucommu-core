import { useState, useEffect } from 'react';
import { Member } from '../types';
import { fetchMembers } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { UserAvatar } from '../components/UserAvatar';

export function MemberPage() {
  const { t } = useI18n();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMembers()
      .then(data => setMembers(data.members || []))
      .catch(e => console.error('Failed to load members:', e))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex flex-col h-full">
      <header className="sticky top-0 bg-black/80 backdrop-blur-sm border-b border-neutral-900 z-10">
        <h1 className="text-xl font-bold px-4 py-3">{t('members.title')}</h1>
      </header>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-8 text-center text-neutral-500">{t('common.loading')}</div>
        ) : members.length === 0 ? (
          <div className="p-8 text-center text-neutral-500">{t('members.noMembers')}</div>
        ) : (
          members.map(member => (
            <div
              key={member.id}
              className="flex items-center gap-3 px-4 py-3 border-b border-neutral-900 hover:bg-neutral-900/30 transition-colors"
            >
              <UserAvatar
                avatarUrl={member.avatar_url}
                name={member.display_name || member.username}
                size={48}
              />
              <div className="flex-1 min-w-0">
                <div className="font-bold text-white truncate">
                  {member.display_name || member.username}
                </div>
                <div className="text-sm text-neutral-500 truncate">@{member.username}</div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
