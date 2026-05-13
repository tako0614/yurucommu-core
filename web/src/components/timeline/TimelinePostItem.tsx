import { A } from "@solidjs/router";
import { For, Show } from "solid-js";
import type { Post } from "../../types/index.ts";
import { formatRelativeTime } from "../../lib/datetime.ts";
import { UserAvatar } from "../UserAvatar.tsx";
import { PostContent } from "../PostContent.tsx";
import {
  BookmarkIcon,
  HeartIcon,
  ReplyIcon,
  RepostIcon,
} from "../icons/SocialIcons.tsx";

interface TimelinePostItemProps {
  post: Post;
  onReply: (post: Post) => void;
  onRepost: (post: Post) => void;
  onLike: (post: Post) => void;
  onBookmark: (post: Post) => void;
}

export function TimelinePostItem(props: TimelinePostItemProps) {
  return (
    <div class="flex gap-3 px-4 py-3 border-b border-neutral-900 hover:bg-neutral-900/30 transition-colors">
      <A href={`/profile/${encodeURIComponent(props.post.author.ap_id)}`}>
        <UserAvatar
          avatarUrl={props.post.author.icon_url}
          name={props.post.author.name || props.post.author.username}
          size={48}
        />
      </A>
      <div class="flex-1 min-w-0">
        <div class="flex items-baseline gap-2">
          <A
            href={`/profile/${encodeURIComponent(props.post.author.ap_id)}`}
            class="font-bold text-white truncate hover:underline"
          >
            {props.post.author.name || props.post.author.username}
          </A>
          <span class="text-neutral-500 truncate">
            @{props.post.author.username}
          </span>
          <span class="text-neutral-500">{"\u00B7"}</span>
          <span class="text-neutral-500 text-sm">
            {formatRelativeTime(props.post.published)}
          </span>
        </div>
        <A href={`/post/${encodeURIComponent(props.post.ap_id)}`} class="block">
          <PostContent
            content={props.post.content}
            class="text-[15px] text-neutral-200 mt-1"
          />
          <Show
            when={props.post.attachments && props.post.attachments.length > 0}
          >
            <div
              class={`mt-3 grid gap-1 rounded-xl overflow-hidden ${
                props.post.attachments!.length === 1
                  ? "grid-cols-1"
                  : "grid-cols-2"
              }`}
            >
              <For each={props.post.attachments}>
                {(m) => (
                  <img
                    src={m.url ||
                      `/media/${m.r2_key.replace(/^uploads\//, "")}`}
                    alt=""
                    class="w-full object-cover max-h-96"
                  />
                )}
              </For>
            </div>
          </Show>
        </A>
        <div class="flex items-center gap-6 mt-3">
          <button
            onClick={() => props.onReply(props.post)}
            aria-label="Reply"
            class="flex items-center gap-2 text-neutral-500 hover:text-blue-500 transition-colors"
          >
            <ReplyIcon />
            <span class="text-sm">{props.post.reply_count || ""}</span>
          </button>
          <button
            onClick={() => props.onRepost(props.post)}
            aria-label={props.post.reposted ? "Undo repost" : "Repost"}
            aria-pressed={props.post.reposted}
            class={`flex items-center gap-2 transition-colors ${
              props.post.reposted
                ? "text-green-500"
                : "text-neutral-500 hover:text-green-500"
            }`}
          >
            <RepostIcon filled={props.post.reposted} />
            <Show when={props.post.announce_count > 0}>
              <span class="text-sm">{props.post.announce_count}</span>
            </Show>
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
            <HeartIcon filled={props.post.liked} />
            <Show when={props.post.like_count > 0}>
              <span class="text-sm">{props.post.like_count}</span>
            </Show>
          </button>
          <button
            onClick={() => props.onBookmark(props.post)}
            aria-label={props.post.bookmarked ? "Remove bookmark" : "Bookmark"}
            aria-pressed={props.post.bookmarked}
            class={`flex items-center gap-2 transition-colors ${
              props.post.bookmarked
                ? "text-blue-500"
                : "text-neutral-500 hover:text-blue-500"
            }`}
          >
            <BookmarkIcon filled={props.post.bookmarked} />
          </button>
        </div>
      </div>
    </div>
  );
}
