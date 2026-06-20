import { A } from "@solidjs/router";
import { Show, createSignal, onCleanup } from "solid-js";
import type { Post } from "../../types/index.ts";
import { formatRelativeTime } from "../../lib/datetime.ts";
import { useI18n } from "../../lib/i18n.tsx";
import { UserAvatar } from "../UserAvatar.tsx";
import { PostContent } from "../PostContent.tsx";
import {
  BookmarkIcon,
  HeartIcon,
  ReplyIcon,
  RepostIcon,
} from "../icons/SocialIcons.tsx";
import { PostActionsMenu } from "./PostActionsMenu.tsx";
import { ScopeChip } from "../scope/ScopeChip.tsx";
import {
  AttachmentGrid,
  MediaLightbox,
  useMediaLightbox,
} from "../MediaLightbox.tsx";

interface TimelinePostItemProps {
  post: Post;
  onReply: (post: Post) => void;
  onRepost: (post: Post) => void;
  onLike: (post: Post) => void;
  onBookmark: (post: Post) => void;
  // Optional overflow-menu wiring; when provided, a ⋯ menu is shown.
  currentActorApId?: string;
  onDelete?: (post: Post) => void;
  onMute?: (post: Post) => void;
  onBlock?: (post: Post) => void;
  onEdit?: (post: Post) => void;
}

// Window (ms) inside which a second tap on the media counts as a double-tap.
const DOUBLE_TAP_MS = 280;

// True on touch/pen devices where the lightbox open must be deferred so a
// second tap can be recognized as a double-tap. Mouse clicks act immediately.
const isCoarsePointer = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(pointer: coarse)").matches;

export function TimelinePostItem(props: TimelinePostItemProps) {
  const { t } = useI18n();
  const lightbox = useMediaLightbox();
  const [burst, setBurst] = createSignal(false);
  // Shared content-warning reveal state: a single reveal un-hides both the
  // text body (PostContent) and the media hero below it.
  const [cwRevealed, setCwRevealed] = createSignal(false);

  const hasMedia = () =>
    !!props.post.attachments && props.post.attachments.length > 0;

  const hasSummary = () => !!props.post.summary && !!props.post.summary.trim();
  // The media hero is hidden behind the CW until revealed.
  const mediaHidden = () => hasSummary() && !cwRevealed();

  // Single tap on the media opens the lightbox; a second tap within the window
  // is a double-tap that adds a like (Instagram-style: like-only, never
  // unlike) and plays the heart burst. We defer the single-tap lightbox open by
  // one window so a double-tap can cancel it.
  //
  // The pending open is tracked WITH the tapped index: in a multi-image grid a
  // second tap only counts as a double-tap when it lands on the SAME image. A
  // tap on a different image cancels the first pending open and schedules its
  // own (so it still opens the lightbox), rather than mis-firing a like and
  // swallowing the open.
  let pendingOpen: {
    index: number;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  let burstTimer: ReturnType<typeof setTimeout> | null = null;
  onCleanup(() => {
    if (pendingOpen) clearTimeout(pendingOpen.timer);
    if (burstTimer) clearTimeout(burstTimer);
  });

  // Anchor the heart burst at the tapped point (within the media hero) so it
  // does not always land on the collage center for multi-image posts.
  const [burstPos, setBurstPos] = createSignal<{ x: number; y: number } | null>(
    null,
  );

  const fireBurst = (e?: MouseEvent) => {
    setBurst(false);
    if (e) {
      const host = (e.currentTarget as HTMLElement | null)?.closest(
        "[data-media-hero]",
      ) as HTMLElement | null;
      if (host) {
        const rect = host.getBoundingClientRect();
        setBurstPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      } else {
        setBurstPos(null);
      }
    }
    // Force a reflow-free restart of the animation on rapid repeat double-taps.
    if (burstTimer) clearTimeout(burstTimer);
    requestAnimationFrame(() => {
      setBurst(true);
      burstTimer = setTimeout(() => setBurst(false), 900);
    });
  };

  // Defer the lightbox open for `index` by one double-tap window so a second
  // tap on the same image can cancel it into a like.
  const scheduleOpen = (index: number) => {
    const items = props.post.attachments!;
    pendingOpen = {
      index,
      timer: setTimeout(() => {
        pendingOpen = null;
        lightbox.open(items, index);
      }, DOUBLE_TAP_MS),
    };
  };

  const handleMediaTap = (index: number, e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (pendingOpen) {
      const sameImage = pendingOpen.index === index;
      clearTimeout(pendingOpen.timer);
      pendingOpen = null;
      if (sameImage) {
        // Second tap on the same image within the window -> double-tap like.
        fireBurst(e);
        // Like-only: a double-tap never removes an existing like.
        if (!props.post.liked) props.onLike(props.post);
        return;
      }
      // A first tap on a different image: cancel the stale pending open and
      // schedule this one so the lightbox still opens.
      scheduleOpen(index);
      return;
    }
    // On mouse (fine pointers) there is no double-tap-to-like gesture, so open
    // the lightbox immediately instead of deferring by the double-tap window.
    if (!isCoarsePointer()) {
      lightbox.open(props.post.attachments!, index);
      return;
    }
    scheduleOpen(index);
  };

  const header = (
    <div class="flex min-w-0 items-baseline gap-2">
      <A
        href={`/profile/${encodeURIComponent(props.post.author.ap_id)}`}
        class="truncate font-bold text-white hover:underline"
      >
        {props.post.author.name || props.post.author.username}
      </A>
      <span class="truncate text-neutral-500">
        @{props.post.author.username}
      </span>
      <span class="text-neutral-500">{"·"}</span>
      <span class="text-sm text-neutral-500">
        {formatRelativeTime(props.post.published)}
      </span>
      <Show when={props.post.edited_at}>
        <span class="text-neutral-500">{"·"}</span>
        <span
          class="text-sm text-neutral-500"
          title={formatRelativeTime(props.post.edited_at!)}
        >
          {t("posts.edited")}
        </span>
      </Show>
      <ScopeChip
        communityApId={props.post.community_ap_id}
        class="ml-auto self-center"
      />
    </div>
  );

  const actions = (
    <div class="flex items-center gap-6 mt-3">
      <button
        onClick={() => props.onReply(props.post)}
        aria-label={t("posts.reply")}
        class="flex items-center gap-2 text-neutral-500 hover:text-[var(--accent)] transition-colors"
      >
        <ReplyIcon />
        <span class="text-sm">{props.post.reply_count || ""}</span>
      </button>
      <button
        onClick={() => props.onRepost(props.post)}
        aria-label={
          props.post.reposted ? t("posts.undoRepost") : t("posts.repost")
        }
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
        aria-label={props.post.liked ? t("posts.unlike") : t("posts.like")}
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
        aria-label={
          props.post.bookmarked
            ? t("posts.removeBookmark")
            : t("posts.bookmark")
        }
        aria-pressed={props.post.bookmarked}
        class={`flex items-center gap-2 transition-colors ${
          props.post.bookmarked
            ? "text-accent"
            : "text-neutral-500 hover:text-[var(--accent)]"
        }`}
      >
        <BookmarkIcon filled={props.post.bookmarked} />
      </button>
      <Show when={props.onDelete && props.onMute && props.onBlock}>
        <PostActionsMenu
          post={props.post}
          isOwn={props.currentActorApId === props.post.author.ap_id}
          onDelete={props.onDelete!}
          onMute={props.onMute!}
          onBlock={props.onBlock!}
          onEdit={props.onEdit}
        />
      </Show>
    </div>
  );

  const lightboxOverlay = (
    <Show when={lightbox.isOpen()}>
      <MediaLightbox
        attachments={lightbox.attachments()}
        index={lightbox.index()}
        onClose={lightbox.close}
      />
    </Show>
  );

  // --- Media-forward card variant ---
  //
  // When a post carries attachments we promote the media to an edge-to-edge
  // hero with a slim header above it. The hero supports double-tap-to-like with
  // a pink heart burst; single taps still open the lightbox.
  return (
    <Show
      when={hasMedia()}
      fallback={
        <div class="flex gap-3 px-4 py-3 border-b border-neutral-900 hover:bg-neutral-900/30 transition-colors">
          <A href={`/profile/${encodeURIComponent(props.post.author.ap_id)}`}>
            <UserAvatar
              avatarUrl={props.post.author.icon_url}
              name={props.post.author.name || props.post.author.username}
              size={48}
            />
          </A>
          <div class="flex-1 min-w-0">
            {header}
            <A
              href={`/post/${encodeURIComponent(props.post.ap_id)}`}
              class="block"
            >
              <PostContent
                content={props.post.content}
                summary={props.post.summary}
                class="text-[15px] text-neutral-200 mt-1"
              />
            </A>
            {actions}
          </div>
          {lightboxOverlay}
        </div>
      }
    >
      <article class="border-b border-neutral-900 hover:bg-neutral-900/20 transition-colors">
        {/* Slim header */}
        <div class="flex items-center gap-2.5 px-4 pt-3 pb-2">
          <A href={`/profile/${encodeURIComponent(props.post.author.ap_id)}`}>
            <UserAvatar
              avatarUrl={props.post.author.icon_url}
              name={props.post.author.name || props.post.author.username}
              size={36}
            />
          </A>
          <div class="min-w-0 flex-1">{header}</div>
        </div>

        {/* Optional text above the hero */}
        <Show when={props.post.content}>
          <A
            href={`/post/${encodeURIComponent(props.post.ap_id)}`}
            class="block px-4 pb-2"
          >
            <PostContent
              content={props.post.content}
              summary={props.post.summary}
              class="text-[15px] text-neutral-200"
              revealed={cwRevealed()}
              onToggleReveal={() => setCwRevealed((v) => !v)}
            />
          </A>
        </Show>

        {/* Edge-to-edge media hero with double-tap-to-like. When the post has a
            content warning, the hero stays hidden behind a blurred placeholder
            until the CW is revealed (shared with the text body above). */}
        <div
          data-media-hero
          class="relative select-none"
          aria-label={t("post.doubleTapLike")}
        >
          <Show
            when={mediaHidden()}
            fallback={
              <AttachmentGrid
                attachments={props.post.attachments!}
                onOpen={handleMediaTap}
                class="mt-0 rounded-none"
              />
            }
          >
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setCwRevealed(true);
              }}
              class="relative block w-full overflow-hidden"
            >
              <div class="pointer-events-none scale-110 blur-2xl">
                <AttachmentGrid
                  attachments={props.post.attachments!}
                  onOpen={() => {}}
                  class="mt-0 rounded-none"
                />
              </div>
              <div class="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/40 px-4 text-center">
                <span class="text-sm font-bold text-white">
                  {t("post.sensitiveContentHidden")}
                </span>
                <span class="rounded-full bg-neutral-800/90 px-3 py-1 text-sm font-bold text-neutral-100">
                  {t("post.showSensitive")}
                </span>
              </div>
            </button>
          </Show>
          {/* Pink heart burst overlay, anchored at the tapped point. */}
          <Show when={burst()}>
            <Show
              when={burstPos()}
              fallback={
                <div class="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div class="animate-heart-burst drop-shadow-lg">
                    <HeartIcon filled class="h-24 w-24 text-pink-500" />
                  </div>
                </div>
              }
            >
              <div
                class="pointer-events-none absolute"
                style={{
                  left: `${burstPos()!.x}px`,
                  top: `${burstPos()!.y}px`,
                  transform: "translate(-50%, -50%)",
                }}
              >
                <div class="animate-heart-burst drop-shadow-lg">
                  <HeartIcon filled class="h-24 w-24 text-pink-500" />
                </div>
              </div>
            </Show>
          </Show>
        </div>

        <div class="px-4 pb-3">{actions}</div>
        {lightboxOverlay}
      </article>
    </Show>
  );
}
