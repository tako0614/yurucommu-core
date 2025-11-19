import { createMemo, createResource, createSignal, For, Show } from "solid-js";
import {
  listMyCommunities,
  listCommunityPosts,
  listGlobalPosts,
  getUser,
  useMe,
} from "../lib/api";
import Avatar from "../components/Avatar";
import ProfileModal from "../components/ProfileModal";
import AccountManager from "../components/AccountManager";
import { buildProfileUrlByHandle, buildActivityPubHandle, getUserDomain } from "../lib/url";

function formatTimestamp(value?: string) {
  if (!value) return "";
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return date.toLocaleString();
  } catch {
    return value;
  }
}

export default function Profile() {
  const me = useMe();
  const [shareOpen, setShareOpen] = createSignal(false);
  const [profileModalView, setProfileModalView] = createSignal<"share" | "scan">("share");

  // 参加コミュニティ
  const [communities] = createResource(async () =>
    listMyCommunities().catch(() => [])
  );

  // 自分の投稿（参加コミュニティ横断で取得して author_id で絞り込み）
  const [myPosts] = createResource(
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

  function FeedItem(props: { p: any }) {
    const [isLiked, setIsLiked] = createSignal(false);
    const [likeCount, setLikeCount] = createSignal(props.p.like_count || 0);
    const [author] = createResource(async () =>
      getUser(props.p.author_id).catch(() => null)
    );
    const formattedCreatedAt = createMemo(() =>
      formatTimestamp(props.p.created_at)
    );

    const handleLike = () => {
      setIsLiked(!isLiked());
      setLikeCount(likeCount() + (isLiked() ? -1 : 1));
    };

    return (
      <article class="bg-white dark:bg-neutral-900 border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-neutral-800 transition-colors cursor-pointer">
        {/* Community header */}
        <Show when={props.p.community_id}>
          <a
            href={`/c/${props.p.community_id}`}
            class="px-4 pt-2 flex items-center gap-2 text-xs text-gray-500 hover:underline"
          >
            <Avatar
              src={props.p.community_icon_url || ""}
              alt="コミュニティ"
              class="w-4 h-4 rounded"
              variant="community"
            />
            <span>{props.p.community_name || "コミュニティ"}</span>
          </a>
        </Show>
        {/* Main row */}
        <Show when={author()}>
          <div class="px-4 pb-3 pt-2 flex items-start gap-3">
            <Avatar
              src={author()?.avatar_url || ""}
              alt="アバター"
              class="w-12 h-12 rounded-full bg-gray-200 dark:bg-neutral-700 object-cover flex-shrink-0"
            />
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-1 text-[15px]">
                <span class="font-bold text-gray-900 dark:text-white truncate">
                  {author()?.display_name}
                </span>
              <span class="text-gray-500">·</span>
              <span class="text-gray-500">{formattedCreatedAt()}</span>
            </div>
            {/* Body */}
            <div class="mt-1 text-[15px] leading-[1.4] text-gray-900 dark:text-white whitespace-pre-wrap">
              {props.p.text}
            </div>
            {/* Media */}
            {props.p.media_urls && props.p.media_urls.length > 0 && (
              <div class="mt-3 rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-700">
                <img
                  src={props.p.media_urls[0]}
                  alt="投稿画像"
                  class="w-full h-auto max-h-96 object-cover"
                />
              </div>
            )}
            {/* Actions */}
            <div class="flex items-center justify-between max-w-md mt-3">
              <button
                class="flex items-center gap-2 text-gray-500 hover:text-blue-500 group"
                aria-label="リプライ"
              >
                <div class="p-2 rounded-full group-hover:bg-blue-50 dark:group-hover:bg-blue-900/20 transition-colors">
                  <svg
                    class="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
                    />
                  </svg>
                </div>
                <span class="text-sm">{props.p.comment_count || 0}</span>
              </button>
              <button
                class="flex items-center gap-2 text-gray-500 hover:text-green-500 group"
                aria-label="リポスト"
              >
                <div class="p-2 rounded-full group-hover:bg-green-50 dark:group-hover:bg-green-900/20 transition-colors">
                  <svg
                    class="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                </div>
                <span class="text-sm">{props.p.reaction_count || 0}</span>
              </button>
              <button
                class={`flex items-center gap-2 group ${
                  isLiked()
                    ? "text-red-500"
                    : "text-gray-500 hover:text-red-500"
                }`}
                onClick={handleLike}
                aria-label="いいね"
              >
                <div
                  class={`p-2 rounded-full group-hover:bg-red-50 dark:group-hover:bg-red-900/20 transition-colors ${
                    isLiked() ? "bg-red-50 dark:bg-red-900/20" : ""
                  }`}
                >
                  <svg
                    class={`w-5 h-5 ${isLiked() ? "fill-current" : ""}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
                    />
                  </svg>
                </div>
                <span class="text-sm">{likeCount()}</span>
              </button>
              <button
                class="flex items-center gap-2 text-gray-500 hover:text-blue-500 group"
                aria-label="共有"
              >
                <div class="p-2 rounded-full group-hover:bg-blue-50 dark:group-hover:bg-blue-900/20 transition-colors">
                  <svg
                    class="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M4 12v.01M8 12v.01M12 12v.01M16 12v.01M20 12v.01"
                    />
                  </svg>
                </div>
              </button>
            </div>
          </div>
        </div>
      </Show>
      </article>
    );
  }

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
                <div class="mt-2 flex items-center gap-8">
                  <div>
                    <div class="text-[15px] font-semibold text-gray-900 dark:text-white">
                      {myPosts()?.length ?? 0}
                    </div>
                    <div class="text-[12px] text-muted">投稿</div>
                  </div>
                  <div>
                    <div class="text-[15px] font-semibold text-gray-900 dark:text-white">
                      {communities()?.length ?? 0}
                    </div>
                    <div class="text-[12px] text-muted">参加中</div>
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
                  {(p: any) => <FeedItem p={p} />}
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
