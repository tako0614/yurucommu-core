import { For, Show, createResource, createSignal } from "solid-js";
import Avatar from "../components/Avatar";
import {
  acceptCommunityInvite,
  declineCommunityInvite,
  listMyInvitations,
} from "../lib/api";

export default function Invitations() {
  const [invites, { refetch }] = createResource(async () =>
    (await listMyInvitations().catch(() => [])) as any[],
  );
  const [busy, setBusy] = createSignal<string | null>(null);
  const [message, setMessage] = createSignal<string | null>(null);

  const handleAction = async (
    communityId: string,
    action: "accept" | "decline",
  ) => {
    setBusy(communityId);
    setMessage(null);
    try {
      if (action === "accept") {
        await acceptCommunityInvite(communityId);
      } else {
        await declineCommunityInvite(communityId);
      }
      await refetch();
      setMessage(action === "accept" ? "参加しました。" : "辞退しました。");
    } catch (error: any) {
      setMessage(error?.message || "処理に失敗しました。");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div class="max-w-4xl mx-auto px-4 py-6 space-y-6">
      <div class="flex items-center gap-3">
        <h1 class="text-2xl font-bold">招待一覧</h1>
        <span class="text-sm text-muted">コミュニティからの招待を管理</span>
        <a
          class="ml-auto text-sm text-blue-600 hover:underline"
          href="/communities"
        >
          コミュニティ一覧
        </a>
      </div>

      <section class="bg-white dark:bg-neutral-900 border hairline rounded-2xl p-4 space-y-3">
        <Show when={message()}>
          <div class="text-sm text-muted">{message()}</div>
        </Show>

        <Show
          when={!invites.loading}
          fallback={<div class="text-sm text-muted">読み込み中…</div>}
        >
          <Show
            when={(invites() || []).length > 0}
            fallback={<div class="text-sm text-muted">招待はありません。</div>}
          >
            <div class="divide-y hairline rounded-xl border hairline overflow-hidden">
              <For each={invites()}>
                {(entry: any) => {
                  const community = entry.community || {};
                  return (
                    <div class="flex items-center gap-3 px-3 py-3">
                      <Avatar
                        src={community.icon_url || ""}
                        alt={community.name || "コミュニティ"}
                        class="w-10 h-10 rounded-full"
                        variant="community"
                      />
                      <div class="flex-1 min-w-0">
                        <div class="font-semibold truncate">
                          {community.name || entry.community_id}
                        </div>
                        <div class="text-xs text-muted truncate">
                          招待ステータス: {entry.status || "pending"}
                        </div>
                      </div>
                      <div class="flex items-center gap-2">
                        <button
                          class="px-3 py-1.5 rounded-full bg-gray-900 text-white text-sm disabled:opacity-60"
                          disabled={busy() === entry.community_id}
                          onClick={() => handleAction(entry.community_id, "accept")}
                        >
                          {busy() === entry.community_id ? "処理中…" : "参加"}
                        </button>
                        <button
                          class="px-3 py-1.5 rounded-full border hairline text-sm disabled:opacity-60"
                          disabled={busy() === entry.community_id}
                          onClick={() => handleAction(entry.community_id, "decline")}
                        >
                          辞退
                        </button>
                        <a
                          class="text-xs px-3 py-1 rounded-full border hairline hover:bg-gray-50"
                          href={`/c/${encodeURIComponent(entry.community_id)}`}
                        >
                          詳細
                        </a>
                      </div>
                    </div>
                  );
                }}
              </For>
            </div>
          </Show>
        </Show>
      </section>
    </div>
  );
}
