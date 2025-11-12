import { apiClient } from "./api-client";

export type Channel = {
  id: string;
  name: string;
  community_id: string;
  created_at: string;
};

export async function listChannels(communityId: string): Promise<Channel[]> {
  return apiClient.listCommunityChannels(communityId) as any;
}

export async function createChannel(
  communityId: string,
  name: string,
): Promise<Channel> {
  return apiClient.createChannel(communityId, name) as any;
}

export async function updateChannel(
  communityId: string,
  channelId: string,
  name: string,
): Promise<Channel> {
  return apiClient.updateChannel(communityId, channelId, name) as any;
}

export async function deleteChannel(
  communityId: string,
  channelId: string,
): Promise<void> {
  return apiClient.deleteChannel(communityId, channelId) as any;
}
