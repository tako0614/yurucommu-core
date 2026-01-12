import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Community, Member } from '../types';
import { fetchCommunities } from '../lib/api';
import { useI18n } from '../lib/i18n';

interface GroupPageProps {
  currentMember: Member;
}

export function GroupPage({ currentMember }: GroupPageProps) {
  const { t } = useI18n();
  const [communities, setCommunities] = useState<Community[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCommunities()
      .then(data => setCommunities(data.communities || []))
      .catch(e => console.error('Failed to load communities:', e))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex flex-col h-full">
      <header className="sticky top-0 bg-black/80 backdrop-blur-sm border-b border-neutral-900 z-10">
        <h1 className="text-xl font-bold px-4 py-3">{t('groups.title')}</h1>
      </header>
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-8 text-center text-neutral-500">{t('common.loading')}</div>
        ) : communities.length === 0 ? (
          <div className="p-8 text-center text-neutral-500">{t('groups.noGroups')}</div>
        ) : (
          <>
            <div className="p-4 text-sm text-neutral-500 border-b border-neutral-900">
              コミュニティの投稿はホームタブから確認できます
            </div>
            {communities.map(community => (
              <Link
                key={community.id}
                to={`/?community=${community.id}`}
                className="flex items-center gap-3 px-4 py-3 border-b border-neutral-900 hover:bg-neutral-900/30 transition-colors"
              >
                <div className="w-12 h-12 rounded-lg bg-neutral-800 flex items-center justify-center text-xl">
                  {community.icon_url ? (
                    <img src={community.icon_url} alt="" className="w-full h-full rounded-lg object-cover" />
                  ) : (
                    community.name.charAt(0).toUpperCase()
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-white truncate">{community.name}</div>
                  {community.description && (
                    <div className="text-sm text-neutral-500 truncate">{community.description}</div>
                  )}
                </div>
              </Link>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
