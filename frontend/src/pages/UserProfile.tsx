import { createMemo, createResource, createSignal, For, Show } from "solid-js";
import { useParams, useLocation } from "@solidjs/router";
import { api, getUser, followUser, unfollowUser, useMe } from "../lib/api";
import ProfileModal from "../components/ProfileModal";
import PostCard from "../components/PostCard";
import { buildProfileUrlByHandle, buildActivityPubHandle, getUserDomain } from "../lib/url";

console.log("[UserProfile] Module loaded");

function parseFullHandle(raw: string): { username: string; domain: string | null } {
  const trimmed = (raw || "").trim();
  const withoutPrefix = trimmed.replace(/^@+/, "");
  if (!withoutPrefix) return { username: "", domain: null };

  const parts = withoutPrefix.split("@");
  if (parts.length >= 2) {
    // Full handle: user@domain or user@domain@domain (handle redundancy)
    return {
      username: parts[0] || "",
      domain: parts[1] || null,
    };
  }

  // Local handle only
  return {
    username: parts[0] || withoutPrefix,
    domain: null,
  };
}

function extractDomainFromUrl(input?: string | null): string | undefined {
  if (!input || typeof input !== "string") return undefined;
  try {
    const url = new URL(input);
    return url.hostname || undefined;
  } catch {
    return undefined;
  }
}

function normalizeUserProfile(raw: any, fallbackHandle: string, fallbackDomain?: string) {
  const data = (raw && typeof raw === "object" && "data" in raw && (raw as any).data) || raw || {};
  const actorId = typeof data.id === "string" ? data.id : undefined;
  const candidateDomain =
    (typeof data.domain === "string" && data.domain.trim()) ||
    (typeof fallbackDomain === "string" && fallbackDomain.trim()) ||
    extractDomainFromUrl(typeof data.url === "string" ? data.url : undefined) ||
    extractDomainFromUrl(actorId);

  const handle =
    (typeof data.handle === "string" && data.handle.trim()) ||
    (typeof data.username === "string" && data.username.trim()) ||
    (typeof data.preferredUsername === "string" && data.preferredUsername.trim()) ||
    (typeof fallbackHandle === "string" && fallbackHandle.trim()) ||
    (actorId ? actorId.split("/").pop() : undefined);

  const displayName =
    (typeof data.display_name === "string" && data.display_name.trim()) ||
    (typeof data.name === "string" && data.name.trim()) ||
    (typeof data.preferredUsername === "string" && data.preferredUsername.trim()) ||
    (typeof data.username === "string" && data.username.trim()) ||
    handle ||
    fallbackHandle;

  const avatarUrl =
    (typeof data.avatar_url === "string" && data.avatar_url.trim()) ||
    (Array.isArray(data.icon)
      ? data.icon.find((icon: any) => icon?.url)?.url
      : data.icon && typeof data.icon === "object"
        ? (data.icon as any).url
        : undefined);

  const normalized: any = { ...data };
  if (!normalized.handle && handle) normalized.handle = handle;
  if (!normalized.id && handle) normalized.id = handle;
  normalized.display_name = displayName;
  normalized.domain = candidateDomain;
  if (avatarUrl) normalized.avatar_url = avatarUrl;
  return normalized;
}

function buildFollowTargetId(user: any): string | null {
  const rawId = (user?.id || user?.handle || "").toString().trim();
  if (!rawId) return null;
  if (rawId.includes("@")) return rawId;
  const domain =
    typeof user?.domain === "string" && user.domain.trim()
      ? user.domain.trim()
      : null;
  const handle = rawId.replace(/^@+/, "");
  return domain ? `@${handle}@${domain}` : handle;
}

export default function UserProfile() {
  console.log("[UserProfile] Component rendering");
  const params = useParams();
  const location = useLocation();
  const profileParam = createMemo(() => {
    // Get handle from pathname (everything after /@)
    const pathname = location.pathname;
    const match = pathname.match(/^\/@(.+)$/);
    const raw = match ? match[1] : (params as any).rest || (params as any).handle || (params as any)["*"] || "";
    console.log("[UserProfile] pathname:", pathname, "raw handle:", raw, "params:", params);
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
  const handleInfo = createMemo(() => {
    const parsed = parseFullHandle(profileParam());
    console.log("[UserProfile] parsed handle:", {
      raw: profileParam(),
      username: parsed.username,
      domain: parsed.domain,
    });
    return parsed;
  });
  const lookupId = createMemo(() => handleInfo().username);

  // me() can be undefined if not logged in - profile pages are public
  const me = useMe();
  const [shareOpen, setShareOpen] = createSignal(false);
  const [profileModalView, setProfileModalView] = createSignal<"share" | "scan">("share");
  const [user, { mutate: setUser }] = createResource(
    () => ({ id: lookupId(), domain: handleInfo().domain }),
    async (params) => {
      const { id, domain } = params;
      if (!id) throw new Error("missing profile id");
      console.log("[UserProfile] fetching user with id:", id, "domain:", domain);

      try {
        // Always resolve profiles through the current backend.
        // Remote servers might not expose the same API (ActivityPub only),
        // so avoid direct cross-domain fetches.
        const lookup = domain ? `@${id}@${domain}` : id;
        const result = await getUser(lookup);
        console.log("[UserProfile] user fetch success:", result);
        return normalizeUserProfile(result, id, domain || undefined);
      } catch (error) {
        console.error("[UserProfile] user fetch failed:", error);
        throw error;
      }
    },
  );
  const [loading, setLoading] = createSignal(false);
  // 自分の参加コミュニティから閲覧可能な投稿のみ集計（ログインしていない場合は空配列）
  const [communities] = createResource(async () => {
    // Only fetch communities if logged in
    if (!me()) return [];
    return api("/me/communities").catch(() => []);
  });
  const [posts, { mutate: setPosts }] = createResource(
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
  const handlePostUpdated = (updated: any) => {
    setPosts((prev) => {
      if (!Array.isArray(prev)) return prev;
      return prev.map((p: any) =>
        p.id === updated?.id ? { ...p, ...updated } : p,
      );
    });
  };
  const handlePostDeleted = (id: string) => {
    setPosts((prev) => {
      if (!Array.isArray(prev)) return prev;
      return prev.filter((p: any) => p.id !== id);
    });
  };

  const relationship = createMemo(() => (user() as any)?.relationship || {});
  const friendStatus = createMemo(() => (user() as any)?.friend_status || null);
  const followingStatus = createMemo(() => {
    const rel = relationship() as any;
    return rel?.following ?? friendStatus() ?? null;
  });
  const isFriend = createMemo(() => {
    const rel = relationship() as any;
    if (typeof rel?.is_friend === "boolean") return rel.is_friend;
    return friendStatus() === "accepted";
  });

  const onFollow = async () => {
    if (!user()) return;
    const target = buildFollowTargetId(user());
    if (!target) return;
    setLoading(true);
    try {
      await followUser(target);
      setUser((prev) =>
        prev
          ? ({
              ...prev,
              relationship: {
                ...(prev as any).relationship,
                following: "pending",
                is_friend: (prev as any).relationship?.is_friend || false,
              },
            } as any)
          : prev,
      );
    } catch {}
    setLoading(false);
  };

  const onUnfollow = async () => {
    if (!user()) return;
    const target = buildFollowTargetId(user());
    if (!target) return;
    setLoading(true);
    try {
      await unfollowUser(target);
      setUser((prev) =>
        prev
          ? ({
              ...prev,
              relationship: {
                ...(prev as any).relationship,
                following: null,
                is_friend: false,
              },
              friend_status: null,
            } as any)
          : prev,
      );
    } catch {}
    setLoading(false);
  };


  const profileDomain = createMemo(() => getUserDomain(user()));

  const shareUrl = createMemo(() => {
    const handle = (user() as any)?.handle;
    if (!handle) return "";
    const domain = profileDomain();
    return buildProfileUrlByHandle(handle, domain);
  });

  const shareHandle = createMemo(() => {
    const handle = (user() as any)?.handle;
    if (!handle) return user()?.id || "";
    const domain = profileDomain();
    return buildActivityPubHandle(handle, domain);
  });
  const shareAvatar = createMemo(() => user()?.avatar_url || "");

  const externalProfileUrl = createMemo(() => {
    const handle = (user() as any)?.handle;
    const domain = profileDomain();
    if (!handle || !domain) return "";
    return buildProfileUrlByHandle(handle, domain);
  });
  const yurucommuUrl = createMemo(() => {
    const handle = (user() as any)?.handle;
    if (!handle) return "";
    const domain = profileDomain();
    const apHandle = buildActivityPubHandle(handle, domain).replace(/^@/, "");
    return `https://yurucommu.com/@${apHandle}`;
  });
  const shouldShowExternalProfileLink = createMemo(() => {
    const domain = profileDomain();
    if (!domain) return false;
    const currentDomain = window.location.hostname.toLowerCase();
    // On yurucommu.com root, we don't need a "open on domain" button
    if (currentDomain === "yurucommu.com") return false;
    return currentDomain !== domain.toLowerCase();
  });
  const shouldShowYurucommuButton = createMemo(() => {
    const currentDomain = window.location.hostname.toLowerCase();
    return currentDomain !== "yurucommu.com" && !!user();
  });
  const openOnDomain = () => {
    const url = externalProfileUrl();
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };
  const openInYurucommu = () => {
    const url = yurucommuUrl();
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div class="px-3 sm:px-4 lg:px-6 pt-14">
      <div class="max-w-[680px] mx-auto">
        {/* 外部ドメインで開くボタン */}
        <Show when={shouldShowExternalProfileLink()}>
          <div class="mb-4 bg-linear-to-r from-blue-50 to-cyan-50 dark:from-blue-950 dark:to-cyan-950 border hairline rounded-md p-4">
            <div class="flex items-center justify-between gap-4">
              <div class="flex-1 min-w-0">
                <div class="text-sm font-semibold text-gray-900 dark:text-white truncate">
                  {profileDomain()}で開く
                </div>
                <div class="text-xs text-gray-600 dark:text-gray-400 mt-1 break-all">
                  {externalProfileUrl()}
                </div>
              </div>
              <button
                onClick={openOnDomain}
                class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-full text-sm font-medium transition-colors shrink-0"
              >
                開く
              </button>
            </div>
          </div>
        </Show>

        {/* yurucommuで開くボタン */}
        <Show when={shouldShowYurucommuButton()}>
          <div class="mb-4 bg-linear-to-r from-indigo-50 to-purple-50 dark:from-indigo-950 dark:to-purple-950 border hairline rounded-md p-4">
            <div class="flex items-center justify-between gap-4">
              <div class="flex-1 min-w-0">
                <div class="text-sm font-semibold text-gray-900 dark:text-white truncate">
                  yurucommuで開く
                </div>
                <div class="text-xs text-gray-600 dark:text-gray-400 mt-1 break-all">
                  {yurucommuUrl()}
                </div>
              </div>
              <button
                onClick={openInYurucommu}
                class="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-full text-sm font-medium transition-colors shrink-0"
              >
                開く
              </button>
            </div>
          </div>
        </Show>

        <div class="bg-white dark:bg-neutral-900 border hairline rounded-md p-4">
          <Show when={user.error}>
            <div class="text-center p-6">
              <h2 class="text-xl font-bold text-gray-900 dark:text-white mb-2">
                ユーザーが見つかりません
              </h2>
              <p class="text-sm text-gray-600 dark:text-gray-400 mb-4">
                @{lookupId()} は存在しないか、アクセスできません。
              </p>
              <a
                href="/"
                class="inline-block px-4 py-2 bg-blue-600 text-white rounded-full text-sm hover:bg-blue-700"
              >
                ホームに戻る
              </a>
            </div>
          </Show>
          <Show
            when={!user.error && user()}
            fallback={!user.error && <div class="text-muted">読み込み中…</div>}
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
                      <div class="flex items-center gap-2 flex-wrap">
                        <Show when={isFriend()}>
                          <span class="px-3 py-1.5 rounded-full bg-green-100 text-green-800 text-xs font-semibold">
                            友達（相互フォロー）
                          </span>
                        </Show>
                        <Show when={followingStatus() === "accepted"}>
                          <button
                            class="px-3 py-1.5 rounded-full border hairline text-sm hover:bg-gray-50 dark:hover:bg-neutral-800"
                            disabled={loading()}
                            onClick={onUnfollow}
                          >
                            {loading() ? "解除中…" : "フォロー中"}
                          </button>
                        </Show>
                        <Show when={followingStatus() === "pending"}>
                          <button
                            class="px-3 py-1.5 rounded-full border hairline text-sm hover:bg-gray-50 dark:hover:bg-neutral-800"
                            disabled={loading()}
                            onClick={onUnfollow}
                          >
                            {loading() ? "キャンセル中…" : "フォロー申請中 (取消)"}
                          </button>
                        </Show>
                        <Show when={!followingStatus()}>
                          <button
                            class="px-3 py-1.5 rounded-full bg-black text-white hover:opacity-90 text-sm"
                            disabled={loading()}
                            onClick={onFollow}
                          >
                            {loading() ? "送信中…" : "フォローする"}
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
        displayName={user()?.display_name || ""}
        handle={shareHandle()}
        avatarUrl={shareAvatar()}
        initialView={profileModalView()}
      />
    </div>
  );
}
