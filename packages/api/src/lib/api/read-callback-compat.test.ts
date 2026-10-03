import { expect, test } from "bun:test";
import { fetchBlockedUsers, fetchMutedUsers } from "./actors.ts";
import {
  fetchDMContacts,
  fetchDMUnreadCount,
  fetchDMRequests,
  fetchArchivedDMConversations,
} from "./dm.ts";
import { fetchCommunities } from "./communities.ts";
import { fetchRecommendedUsers } from "./recommendations.ts";

// Existing consumers pass former zero-argument functions directly to resource
// fetchers, which supply their own key. Keep that callback assignability while
// adding an explicit request-control overload. The owning tsc gate checks this.
const resourceFetchers: Array<
  (key: true, info: { refetching: boolean }) => Promise<unknown>
> = [
  fetchBlockedUsers,
  fetchMutedUsers,
  fetchDMContacts,
  fetchDMUnreadCount,
  fetchDMRequests,
  fetchArchivedDMConversations,
  fetchCommunities,
  fetchRecommendedUsers,
];
test("former zero-argument reads remain resource-fetcher compatible", () => {
  expect(resourceFetchers).toHaveLength(8);
});
