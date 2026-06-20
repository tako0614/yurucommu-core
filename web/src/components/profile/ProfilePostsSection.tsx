import { createMemo, For, Show } from "solid-js";
import { A } from "@solidjs/router";
import type { MediaAttachment, Post } from "../../types/index.ts";
import { formatRelativeTime } from "../../lib/datetime.ts";
import { UserAvatar } from "../UserAvatar.tsx";
import { PostContent } from "../PostContent.tsx";
import { HeartIcon, ReplyIcon } from "../icons/SocialIcons.tsx";
import type { Translate } from "../../lib/i18n.tsx";
import { ScopeChip } from "../scope/ScopeChip.tsx";
import {
  AttachmentGrid,
  mediaAttachmentUrl,
  MediaLightbox,
  useMediaLightbox,
} from "../MediaLightbox.tsx";

type ProfileTab = "posts";
type ProfileView = "grid" | "list";

interface ProfilePostsSectionProps {
  activeTab: ProfileTab;
  onChangeTab: (tab: ProfileTab) => void;
  view: ProfileView;
  onChangeView: (view: ProfileView) => void;
  posts: Post[];
  actorApId: string;
  t: Translate;
  onLike: (post: Post) => void;
}

function isVideo(m: MediaAttachment): boolean {
  return (m.content_type || "").startsWith("video/");
}

const GridIcon = () => (
  <svg
    class="h-5 w-5"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width={2}
      d="M4 5h6v6H4V5zm10 0h6v6h-6V5zM4 13h6v6H4v-6zm10 0h6v6h-6v-6z"
    />
  </svg>
);

const ListIcon = () => (
  <svg
    class="h-5 w-5"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width={2}
      d="M4 6h16M4 12h16M4 18h16"
    />
  </svg>
);

const VideoBadge = () => (
  <span class="absolute right-1.5 top-1.5 text-white drop-shadow">
    <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
      <path d="M8 5v14l11-7z" />
    </svg>
  </span>
);

const MultiBadge = () => (
  <span class="absolute right-1.5 top-1.5 text-white drop-shadow">
    <svg
      class="h-4 w-4"
      fill="none"
      stroke="currentColor"
      stroke-width={2}
      viewBox="0 0 24 24"
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        d="M8 8h12v12H8zM4 4h12v12"
      />
    </svg>
  </span>
);

export function ProfilePostsSection(props: ProfilePostsSectionProps) {
  // Media grid is the IG-style default: only posts that carry an attachment.
  const mediaPosts = createMemo(() =>
    props.posts.filter((p) => p.attachments && p.attachments.length > 0),
  );

  return (
    <>
      {/* Tabs */}
      <div class="border-b border-neutral-900 flex">
        <button
          onClick={() => props.onChangeTab("posts")}
          class="flex-1 py-4 text-center font-bold transition-colors relative text-white"
        >
          {props.t("profile.posts")}
          <div class="absolute bottom-0 left-1/2 -translate-x-1/2 w-16 h-1 bg-accent rounded-full" />
        </button>
      </div>

      {/* Posts tab */}
      <Show when={props.activeTab === "posts"}>
        {/* View toggle: media grid (default) vs. detailed list */}
        <div class="flex items-center justify-end gap-1 border-b border-neutral-900 px-3 py-1.5">
          <button
            type="button"
            onClick={() => props.onChangeView("grid")}
            aria-label={props.t("profile.viewGrid")}
            aria-pressed={props.view === "grid"}
            class={`rounded-lg p-1.5 transition-colors ${
              props.view === "grid"
                ? "text-white"
                : "text-neutral-500 hover:text-neutral-300"
            }`}
          >
            <GridIcon />
          </button>
          <button
            type="button"
            onClick={() => props.onChangeView("list")}
            aria-label={props.t("profile.viewList")}
            aria-pressed={props.view === "list"}
            class={`rounded-lg p-1.5 transition-colors ${
              props.view === "list"
                ? "text-white"
                : "text-neutral-500 hover:text-neutral-300"
            }`}
          >
            <ListIcon />
          </button>
        </div>

        {/* Grid view */}
        <Show when={props.view === "grid"}>
          <Show
            when={mediaPosts().length > 0}
            fallback={
              <div class="p-8 text-center text-neutral-500">
                {props.t("profile.noMedia")}
              </div>
            }
          >
            <ProfileMediaGrid posts={mediaPosts()} t={props.t} />
          </Show>
        </Show>

        {/* List view */}
        <Show when={props.view === "list"}>
          <Show
            when={props.posts.length > 0}
            fallback={
              <div class="p-8 text-center text-neutral-500">
                {props.t("timeline.empty")}
              </div>
            }
          >
            <For each={props.posts}>
              {(post) => (
                <ProfilePostItem
                  post={post}
                  actorApId={props.actorApId}
                  onLike={props.onLike}
                  t={props.t}
                />
              )}
            </For>
          </Show>
        </Show>
      </Show>
    </>
  );
}

interface ProfileMediaGridProps {
  posts: Post[];
  t: Translate;
}

// 3-column media grid of posts-with-media. Tapping a cell opens the post's
// attachments in the shared lightbox (first attachment first).
function ProfileMediaGrid(props: ProfileMediaGridProps) {
  const lightbox = useMediaLightbox();
  return (
    <>
      <div class="grid grid-cols-3 gap-0.5">
        <For each={props.posts}>
          {(post) => {
            const first = post.attachments[0];
            const multiple = post.attachments.length > 1;
            return (
              <button
                type="button"
                onClick={() => lightbox.open(post.attachments, 0)}
                aria-label={props.t("lightbox.zoomIn")}
                class="relative block aspect-square w-full overflow-hidden bg-neutral-900"
              >
                <Show
                  when={isVideo(first)}
                  fallback={
                    <img
                      src={mediaAttachmentUrl(first)}
                      alt={first.name || ""}
                      class="h-full w-full object-cover transition-opacity hover:opacity-90"
                    />
                  }
                >
                  <video
                    src={mediaAttachmentUrl(first)}
                    class="h-full w-full object-cover"
                    preload="metadata"
                  />
                </Show>
                <Show when={isVideo(first)}>
                  <VideoBadge />
                </Show>
                <Show when={!isVideo(first) && multiple}>
                  <MultiBadge />
                </Show>
              </button>
            );
          }}
        </For>
      </div>
      <Show when={lightbox.isOpen()}>
        <MediaLightbox
          attachments={lightbox.attachments()}
          index={lightbox.index()}
          onClose={lightbox.close}
        />
      </Show>
    </>
  );
}

interface ProfilePostItemProps {
  post: Post;
  actorApId: string;
  onLike: (post: Post) => void;
  t: Translate;
}

function ProfilePostItem(props: ProfilePostItemProps) {
  const lightbox = useMediaLightbox();
  return (
    <div class="flex gap-3 px-4 py-3 border-b border-neutral-900 hover:bg-neutral-900/30 transition-colors">
      <A href={`/profile/${encodeURIComponent(props.post.author.ap_id)}`}>
        <UserAvatar
          avatarUrl={props.post.author.icon_url}
          name={props.post.author.name || props.post.author.preferred_username}
          size={48}
        />
      </A>
      <div class="flex-1 min-w-0">
        <div class="flex items-baseline gap-2">
          <A
            href={`/profile/${encodeURIComponent(props.post.author.ap_id)}`}
            class="font-bold text-white truncate hover:underline"
          >
            {props.post.author.name || props.post.author.preferred_username}
          </A>
          <span class="text-neutral-500 truncate">
            @{props.post.author.username}
          </span>
          <span class="text-neutral-500">・</span>
          <span class="text-neutral-500 text-sm">
            {formatRelativeTime(props.post.published)}
          </span>
          <ScopeChip
            communityApId={props.post.community_ap_id}
            class="ml-auto self-center"
          />
        </div>
        <PostContent
          content={props.post.content}
          summary={props.post.summary}
          class="text-[15px] text-neutral-200 mt-1"
        />
        <Show
          when={props.post.attachments && props.post.attachments.length > 0}
        >
          <AttachmentGrid
            attachments={props.post.attachments}
            onOpen={(idx, e) => {
              e.preventDefault();
              e.stopPropagation();
              lightbox.open(props.post.attachments, idx);
            }}
          />
        </Show>
        {/* Actions */}
        <div class="flex items-center gap-6 mt-3">
          <button
            aria-label={props.t("posts.reply")}
            class="flex items-center gap-2 text-neutral-500 hover:text-[var(--accent)] transition-colors"
          >
            <ReplyIcon />
            <span class="text-sm">{props.post.reply_count || ""}</span>
          </button>
          <button
            onClick={() => props.onLike(props.post)}
            aria-label={
              props.post.liked ? props.t("posts.unlike") : props.t("posts.like")
            }
            aria-pressed={props.post.liked}
            class={`flex items-center gap-2 transition-colors ${
              props.post.liked
                ? "text-pink-500"
                : "text-neutral-500 hover:text-pink-500"
            }`}
          >
            <HeartIcon filled={props.post.liked || false} />
            <Show
              when={
                props.post.author.ap_id === props.actorApId &&
                props.post.like_count > 0
              }
            >
              <span class="text-sm">{props.post.like_count}</span>
            </Show>
          </button>
        </div>
      </div>
      <Show when={lightbox.isOpen()}>
        <MediaLightbox
          attachments={lightbox.attachments()}
          index={lightbox.index()}
          onClose={lightbox.close}
        />
      </Show>
    </div>
  );
}
