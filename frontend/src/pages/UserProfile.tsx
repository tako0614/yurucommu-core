import { createMemo, createResource, createSignal, For, Show } from "solid-js";
import { useParams } from "@solidjs/router";
import { api, getUser, sendFriendRequest, useMe } from "../lib/api";
import Avatar from "../components/Avatar";
import ProfileModal from "../components/ProfileModal";
import { buildProfileUrlByHandle, buildActivityPubHandle, getUserDomain } from "../lib/url";

function normalizeProfileLookup(raw: string): string {
  const trimmed = (raw || "").trim();
  const withoutPrefix = trimmed.replace(/^@+/, "");
  if (!withoutPrefix) return "";
  const [local] = withoutPrefix.split("@");
  return local || withoutPrefix;
}

export default function UserProfile() {
  const params = useParams();
  const profileParam = createMemo(() => {
    const raw = (params as any).handle || "";
    let current = raw;
    for (let i = 0; i < 3; i += 1) {
      try {
        const decoded = decodeURIComponent(current);
        if (decoded === current) break;
        current = decoded;
      } catch {
        break;
      }
    }
    return current;
  });
  const lookupId = createMemo(() => normalizeProfileLookup(profileParam()));
  // me() can be undefined if not logged in - profile pages are public
  const me = useMe();
  const [shareOpen, setShareOpen] = createSignal(false);
  const [profileModalView, setProfileModalView] = createSignal<"share" | "scan">("share");
  const [user, { mutate: setUser }] = createResource(
    lookupId,
    (id) => {
      if (!id) throw new Error("missing profile id");
      return getUser(id);
    },
  );
  const [loading, setLoading] = createSignal(false);
  // 自分の参加コミュニティから閲覧可能な投稿のみ集計（ログインしていない場合は空配列）
  const [communities] = createResource(async () => {
    // Only fetch communities if logged in
    if (!me()) return [];
    return api("/me/communities").catch(() => []);
  });
  const [posts] = createResource(
    () => ({ u: user(), comms: communities() }),
    async (deps) => {
      const u = deps.u as any;
      const comms = deps.comms as any[];
      if (!u || !Array.isArray(comms)) return [];
      const all: any[] = [];
      try {
        const globalPosts = await api("/posts");
        for (const p of (Array.isArray(globalPosts) ? globalPosts : []) as any[]) {
          if ((p as any)?.author_id === u.id) {
            all.push(p);
          }
        }
      } catch {}
      for (const c of comms) {
        try {
          const list = await api(`/communities/${c.id}/posts`);
          for (const p of list as any[]) {
            if (p.author_id === u.id) {
              all.push({
                ...p,
                community_name: c.name,
                community_icon_url: c.icon_url,
              });
            }
          }
        } catch {}
      }
      return all.sort((a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    },
  );

  const onFollow = async () => {
    if (!user()) return;
    setLoading(true);
    try {
      await sendFriendRequest(user()!.id);
      setUser({ ...user()!, friend_status: "pending" } as any);
    } catch {}
    setLoading(false);
  };

  function FeedItem(props: { p: any }) {
    const [isLiked, setIsLiked] = createSignal(false);
    const [likeCount, setLikeCount] = createSignal(props.p.like_count || 0);
    const [author] = createResource(async () =>
      getUser(props.p.author_id).catch(() => null)
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
              <span class="text-gray-500">{props.p.created_at}</span>
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

  const shareUrl = createMemo(() => {
    const handle = (user() as any)?.handle;
    if (!handle) return "";
    const domain = getUserDomain(user());
    return buildProfileUrlByHandle(handle, domain);
  });

  const shareHandle = createMemo(() => {
    const handle = (user() as any)?.handle;
    if (!handle) return user()?.id || "";
    const domain = getUserDomain(user());
    return buildActivityPubHandle(handle, domain);
  });
  const shareAvatar = createMemo(() => user()?.avatar_url || "");

  const yurucommuUrl = createMemo(() => {
    const handle = shareHandle();
    if (!handle) return "";
    return `https://yurucommu.com/${handle}`;
  });

  const openInYurucommu = () => {
    const url = yurucommuUrl();
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div class="px-3 sm:px-4 lg:px-6 pt-14">
      <div class="max-w-[680px] mx-auto">
        {/* yurucommuで開くボタン */}
        <Show when={user()}>
          <div class="mb-4 bg-linear-to-r from-blue-50 to-purple-50 dark:from-blue-950 dark:to-purple-950 border hairline rounded-md p-4">
            <div class="flex items-center justify-between gap-4">
              <div class="flex-1">
                <div class="text-sm font-semibold text-gray-900 dark:text-white">
                  yurucommuで開く
                </div>
                <div class="text-xs text-gray-600 dark:text-gray-400 mt-1">
                  {yurucommuUrl()}
                </div>
              </div>
              <button
                onClick={openInYurucommu}
                class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-full text-sm font-medium transition-colors shrink-0"
              >
                開く
              </button>
            </div>
          </div>
        </Show>

        <div class="bg-white dark:bg-neutral-900 border hairline rounded-md p-4">
          <Show
            when={user()}
            fallback={<div class="text-muted">読み込み中…</div>}
          >
            <div class="flex items-start gap-4">
              <img
                src={user()?.avatar_url || ""}
                alt="アバター"
                class="w-20 h-20 rounded-full bg-gray-200 dark:bg-neutral-700 object-cover"
              />
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <div class="text-xl font-semibold truncate">
                    {user()!.display_name || "ユーザー"}
                  </div>
                  <span class="text-xs text-muted break-all">
                    ID: @{user()!.handle || user()!.id}
                  </span>
                </div>
                <div class="mt-3 flex items-center gap-8">
                  <div>
                    <div class="text-[15px] font-semibold text-gray-900 dark:text-white">
                      {posts()?.length ?? 0}
                    </div>
                    <div class="text-[12px] text-muted">投稿</div>
                  </div>
                </div>
                <div class="mt-3 flex items-center">
                  <div class="ml-auto flex items-center gap-2">
                    <Show when={me() && user() && me()!.id !== user()!.id}>
                      <div>
                        <Show when={!user()!.friend_status}>
                          <button
                            class="px-3 py-1.5 rounded-full bg-black text-white hover:opacity-90 text-sm"
                            disabled={loading()}
                            onClick={onFollow}
                          >
                            友達になる
                          </button>
                        </Show>
                        <Show when={user()!.friend_status === "pending"}>
                          <button
                            class="px-3 py-1.5 rounded-full border hairline text-sm"
                            disabled
                          >
                            承認待ち
                          </button>
                        </Show>
                        <Show when={user()!.friend_status === "accepted"}>
                          <button
                            class="px-3 py-1.5 rounded-full border hairline text-sm"
                            disabled
                          >
                            友達
                          </button>
                        </Show>
                      </div>
                    </Show>
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
            </div>
          </Show>
        </div>

        {/* 投稿リスト（Home準拠の見た目） */}
        <div class="mt-3 bg-white dark:bg-neutral-900 border hairline rounded-md overflow-hidden">
          <div class="px-3 py-2 text-sm font-medium text-gray-900 dark:text-white">投稿</div>
          <Show
            when={posts()}
            fallback={
              <div class="px-3 py-10 text-center text-muted">
                投稿を読み込み中…
              </div>
            }
          >
            <Show
              when={posts()!.length > 0}
              fallback={
                <div class="px-3 py-10 text-center text-muted">
                  まだ投稿がありません
                </div>
              }
            >
              <div class="grid gap-0">
                <For each={posts() || []}>
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
        displayName={user()?.display_name || ""}
        handle={shareHandle()}
        avatarUrl={shareAvatar()}
        initialView={profileModalView()}
      />
    </div>
  );
}
