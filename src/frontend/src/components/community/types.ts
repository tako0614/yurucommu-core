export type CommunityMember = {
  ap_id: string;
  username: string;
  preferred_username: string;
  name: string | null;
  icon_url: string | null;
  role: 'owner' | 'moderator' | 'member' | string;
  joined_at: string;
};
