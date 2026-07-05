import { apiDelete, apiPost, assertOk } from "./fetch.ts";

export async function follow(targetApId: string): Promise<{ status: string }> {
  const res = await apiPost("/api/follow", { target_ap_id: targetApId });
  await assertOk(res, "Failed to follow");
  return (await res.json()) as { status: string };
}

export async function unfollow(targetApId: string): Promise<void> {
  const res = await apiDelete("/api/follow", { target_ap_id: targetApId });
  await assertOk(res, "Failed to unfollow");
}

export async function acceptFollowRequest(
  requesterApId: string,
): Promise<void> {
  const res = await apiPost("/api/follow/accept", {
    requester_ap_id: requesterApId,
  });
  await assertOk(res, "Failed to accept");
}

export async function rejectFollowRequest(
  requesterApId: string,
): Promise<void> {
  const res = await apiPost("/api/follow/reject", {
    requester_ap_id: requesterApId,
  });
  await assertOk(res, "Failed to reject");
}
