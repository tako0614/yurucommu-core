import { For, Show } from "solid-js";
import { A } from "@solidjs/router";
import type { Post } from "../../types/index.ts";
import { formatRelativeTime } from "../../lib/datetime.ts";
import { UserAvatar } from "../UserAvatar.tsx";
import { PostContent } from "../PostContent.tsx";
import { HeartIcon, ReplyIcon } from "../icons/SocialIcons.tsx";
import type { Translate } from "../../lib/i18n.tsx";
import {
  AttachmentGrid,
  MediaLightbox,
  useMediaLightbox,
} from "../MediaLightbox.tsx";

type ProfileTab = "posts" | "likes";

interface ProfilePostsSectionProps {
  activeTab: ProfileTab;
  onChangeTab: (tab: ProfileTab) => void;
  posts: Post[];
  actorApId: string;
  t: Translate;
  onLike: (post: Post) => void;
}

export function ProfilePostsSection(props: ProfilePostsSectionProps) {
  return (
    <>
      {/* Tabs */}
      <div class="border-b border-neutral-900 flex">
        <button
          onClick={() => props.onChangeTab("posts")}
          class={`flex-1 py-4 text-center font-bold transition-colors relative ${
            props.activeTab === "posts"
              ? "text-white"
              : "text-neutral-500 hover:bg-neutral-900/50"
          }`}
        >
          {props.t("profile.posts")}
          <Show when={props.activeTab === "posts"}>
            <div class="absolute bottom-0 left-1/2 -translate-x-1/2 w-16 h-1 bg-blue-500 rounded-full" />
          </Show>
        </button>
        <button
          onClick={() => props.onChangeTab("likes")}
          class={`flex-1 py-4 text-center font-bold transition-colors relative ${
            props.activeTab === "likes"
              ? "text-white"
              : "text-neutral-500 hover:bg-neutral-900/50"
          }`}
        >
          {props.t("profile.likes")}
          <Show when={props.activeTab === "likes"}>
            <div class="absolute bottom-0 left-1/2 -translate-x-1/2 w-16 h-1 bg-blue-500 rounded-full" />
          </Show>
        </button>
      </div>

      {/* Posts */}
      <Show when={props.activeTab === "posts"}>
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
              />
            )}
          </For>
        </Show>
      </Show>

      {/* Likes Tab */}
      <Show when={props.activeTab === "likes"}>
        <div class="p-8 text-center text-neutral-500">
          {props.t("profile.noLikes")}
        </div>
      </Show>
    </>
  );
}

interface ProfilePostItemProps {
  post: Post;
  actorApId: string;
  onLike: (post: Post) => void;
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
            aria-label="Reply"
            class="flex items-center gap-2 text-neutral-500 hover:text-blue-500 transition-colors"
          >
            <ReplyIcon />
            <span class="text-sm">{props.post.reply_count || ""}</span>
          </button>
          <button
            onClick={() => props.onLike(props.post)}
            aria-label={props.post.liked ? "Unlike" : "Like"}
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
