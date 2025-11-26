import { createMemo, createResource, createSignal, For, Show } from "solid-js";
import {
  listMyCommunities,
  listCommunityPosts,
  listGlobalPosts,
  listMyFriends,
  useMe,
} from "../lib/api";
import ProfileModal from "../components/ProfileModal";
import AccountManager from "../components/AccountManager";
import PostCard from "../components/PostCard";
import { buildProfileUrlByHandle, buildActivityPubHandle, getUserDomain } from "../lib/url";

export default function Profile() {
  const me = useMe();
  const [shareOpen, setShareOpen] = createSignal(false);
  const [profileModalView, setProfileModalView] = createSignal<"share" | "scan">("share");

  // 参加コミュニティ
  const [communities] = createResource(async () =>
    listMyCommunities().catch(() => [])
  );

  const [friends] = createResource(async () =>
    listMyFriends().catch(() => [])
  );

  // 自分の投稿（参加コミュニティ横断で取得して author_id で絞り込み）
  const [myPosts, { mutate: setMyPosts }] = createResource(
    () => ({
      communities: communities(),
      userId: me()?.id,
    }),
    async (ctx) => {
      if (!ctx?.userId) return [];

      const appendCommunityMeta = (post: any, community: any) => {
        if (!post) return post;
        if (community) {
          if (!post.community_name) post.community_name = community.name;
          if (!post.community_icon_url) post.community_icon_url = community.icon_url;
        }
        return post;
      };

      const dedup = new Map<string, any>();
      const addPost = (post: any, community?: any) => {
        if (!post?.id || post.author_id !== ctx.userId) return;
        const enriched = appendCommunityMeta({ ...post }, community);
        dedup.set(post.id, enriched);
      };

      try {
        const globalPosts = await listGlobalPosts();
        for (const post of globalPosts || []) {
          addPost(post);
        }
      } catch {
        // ignore timeline fetch errors
      }

      const communitiesList = Array.isArray(ctx.communities) ? (ctx.communities as any[]) : [];
      if (communitiesList.length) {
        const lists = await Promise.all(
          communitiesList.map((community) =>
            listCommunityPosts(community.id).catch(() => null),
          ),
        );
        lists.forEach((posts, index) => {
          if (!Array.isArray(posts)) return;
          const community = communitiesList[index];
          for (const post of posts) {
            addPost(post, community);
          }
        });
      }

      const items = Array.from(dedup.values());
      items.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
      return items;
    },
  );

  const shareUrl = createMemo(() => {
    const handle = (me() as any)?.handle;
    if (!handle) return "";
    const domain = getUserDomain(me()) || undefined;
    return buildProfileUrlByHandle(handle, domain);
  });
  const shareHandle = createMemo(() => {
    const handle = (me() as any)?.handle;
    if (!handle) return me()?.id || "";
    const domain = getUserDomain(me()) || undefined;
    return buildActivityPubHandle(handle, domain);
  });
  const shareAvatar = createMemo(() => me()?.avatar_url || "");
  const friendCount = createMemo(() => (friends() || []).length);
  const communityCount = createMemo(() => (communities() || []).length);
  const postCount = createMemo(() => (myPosts() || []).length);

  const handlePostUpdated = (updated: any) => {
    setMyPosts((prev) => {
      if (!Array.isArray(prev)) return prev;
      return prev.map((p: any) =>
        p.id === updated?.id ? { ...p, ...updated } : p,
      );
    });
  };

  const handlePostDeleted = (id: string) => {
    setMyPosts((prev) => {
      if (!Array.isArray(prev)) return prev;
      return prev.filter((p: any) => p.id !== id);
    });
  };

  
  return (
    <div class="pt-14 px-3 sm:px-4">
      <div class="mx-auto w-full max-w-2xl space-y-8">
        <Show when={me()} fallback={<div class="text-muted">読み込み中…</div>}>
          <div class="space-y-3">

            <div class="flex items-center gap-4">
              <img
                src={me()?.avatar_url || ""}
                alt="アバター"
                class="w-20 h-20 rounded-full bg-gray-200 dark:bg-neutral-700 object-cover"
              />
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <div class="text-xl font-semibold truncate">
                    {me()!.display_name || "ユーザー"}
                  </div>
                  <span class="text-xs text-muted break-all">
                    ID: @{(me()! as any).handle || me()!.id}
                  </span>
                </div>
                <div class="mt-2 grid grid-cols-3 gap-4 max-w-md">
                  <div class="rounded-lg bg-gray-50 dark:bg-neutral-900 border hairline px-3 py-2">
                    <div class="text-[12px] text-muted">フレンド</div>
                    <div class="text-lg font-semibold">{friendCount()}</div>
                  </div>
                  <div class="rounded-lg bg-gray-50 dark:bg-neutral-900 border hairline px-3 py-2">
                    <div class="text-[12px] text-muted">コミュニティ</div>
                    <div class="text-lg font-semibold">
                      {communityCount()}
                    </div>
                  </div>
                  <div class="rounded-lg bg-gray-50 dark:bg-neutral-900 border hairline px-3 py-2">
                    <div class="text-[12px] text-muted">投稿</div>
                    <div class="text-lg font-semibold">
                      {postCount()}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div class="flex items-center">
              <div class="ml-auto flex items-center gap-2">
                <a
                  href="/profile/edit"
                  class="px-3 py-1.5 border hairline rounded-full text-sm hover:bg-gray-50 dark:hover:bg-neutral-800"
                >
                  プロフィールを編集
                </a>
                <button
                  onClick={() => {
                    setProfileModalView("share");
                    setShareOpen(true);
                  }}
                  class="px-3 py-1.5 border hairline rounded-full text-sm hover:bg-gray-50 dark:hover:bg-neutral-800"
                >
                  プロフィールを共有
                </button>
              </div>
            </div>
          </div>
        </Show>

        <AccountManager />

        {/* 投稿リスト（Home準拠の見た目） */}
        <div class="space-y-4">
          <div class="text-sm font-medium text-gray-900 dark:text-white">投稿</div>
          <Show
            when={myPosts()}
            fallback={
              <div class="py-10 text-center text-muted">投稿を読み込んでいます…</div>
            }
          >
            <Show
              when={myPosts()!.length > 0}
              fallback={
                <div class="py-10 text-center text-muted">まだ投稿がありません</div>
              }
            >
              <div class="grid gap-0">
                <For each={myPosts() || []}>
                  {(p: any) => (
                    <PostCard
                      post={p}
                      onUpdated={handlePostUpdated}
                      onDeleted={handlePostDeleted}
                    />
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </div>
      </div>
      <ProfileModal
        open={shareOpen()}
        onClose={() => {
          setShareOpen(false);
          setProfileModalView("share");
        }}
        profileUrl={shareUrl()}
        displayName={me()?.display_name || ""}
        handle={shareHandle()}
        avatarUrl={shareAvatar()}
        initialView={profileModalView()}
      />
    </div>
  );
}
