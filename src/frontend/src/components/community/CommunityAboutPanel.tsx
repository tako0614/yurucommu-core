import type { CommunityDetail } from '../../lib/api';

interface CommunityAboutPanelProps {
  community: CommunityDetail;
}

export function CommunityAboutPanel({ community }: CommunityAboutPanelProps) {
  return (
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
  );
}
