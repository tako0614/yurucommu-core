import { createSignal, createResource, createMemo, For, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";

import Avatar from "../components/Avatar";
import {
  listMyFriendRequests,
  acceptFriendRequest,
  rejectFriendRequest,
} from "../lib/api";

type User = {
  id: string;
  display_name?: string;
  avatar_url?: string;
};

type FriendRequest = {
  requester: User;
  addressee: User;
  created_at: string;
};

export default function FriendRequests() {
  const navigate = useNavigate();
  const [actionUser, setActionUser] = createSignal<string | null>(null);

  const [incomingRequests, { refetch: refetchIncoming }] = createResource(
    async () => (await listMyFriendRequests("incoming").catch(() => [])) as FriendRequest[]
  );

  const loading = createMemo(() => incomingRequests.loading);

  const incomingCount = createMemo(() => (incomingRequests() || []).length);

  const handleAcceptFriend = async (userId: string) => {
    setActionUser(userId);
    try {
      await acceptFriendRequest(userId);
      await refetchIncoming();
    } catch (error) {
      console.error("Failed to accept friend request:", error);
    } finally {
      setActionUser(null);
    }
  };

  const handleRejectFriend = async (userId: string) => {
    setActionUser(userId);
    try {
      await rejectFriendRequest(userId);
      await refetchIncoming();
    } catch (error) {
      console.error("Failed to reject friend request:", error);
    } finally {
      setActionUser(null);
    }
  };

  return (
    <div class="max-w-2xl mx-auto px-4 py-4">
      {/* Header */}
      <header class="flex items-center gap-3 mb-6">
        <button
          type="button"
          class="p-2 -ml-2 rounded-full hover:bg-gray-100 dark:hover:bg-neutral-800"
          onClick={() => navigate("/connections")}
          aria-label="戻る"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 class="text-xl font-bold">フレンドリクエスト</h1>
      </header>

      <Show when={!loading()} fallback={
        <div class="text-center py-8 text-gray-500">読み込み中...</div>
      }>
        <Show when={incomingCount() > 0} fallback={
          <div class="text-center py-12">
            <div class="text-gray-400 text-4xl mb-3">👋</div>
            <div class="text-gray-600 dark:text-gray-400 mb-2">
              フレンドリクエストはありません
            </div>
            <p class="text-sm text-gray-500">
              友達からのリクエストがあると、ここに表示されます
            </p>
          </div>
        }>
          <div class="space-y-1">
            <For each={incomingRequests()}>
              {(request) => (
                <div class="flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-gray-50 dark:hover:bg-neutral-800 transition-colors">
                  <Avatar
                    src={request.requester.avatar_url || ""}
                    alt={request.requester.display_name || request.requester.id}
                    class="w-12 h-12 rounded-full shrink-0"
                  />
                  <div class="min-w-0 flex-1">
                    <a href={`/@${encodeURIComponent(request.requester.id)}`} class="block">
                      <div class="font-medium truncate">
                        {request.requester.display_name || request.requester.id}
                      </div>
                      <div class="text-sm text-gray-500 dark:text-gray-400 truncate">
                        @{request.requester.id}
                      </div>
                    </a>
                  </div>
                  <div class="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      class="px-3 py-1.5 rounded-full bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-60"
                      disabled={actionUser() === request.requester.id}
                      onClick={() => handleAcceptFriend(request.requester.id)}
                    >
                      {actionUser() === request.requester.id ? "処理中…" : "承認"}
                    </button>
                    <button
                      type="button"
                      class="px-3 py-1.5 rounded-full border dark:border-neutral-700 text-sm hover:bg-gray-50 dark:hover:bg-neutral-800 disabled:opacity-60"
                      disabled={actionUser() === request.requester.id}
                      onClick={() => handleRejectFriend(request.requester.id)}
                    >
                      拒否
                    </button>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  );
}
