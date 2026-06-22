import { createSignal, onCleanup, onMount, Show } from "solid-js";
import type { Post } from "../../types/index.ts";
import { useI18n } from "../../lib/i18n.tsx";
import { ConfirmSheet } from "../ConfirmSheet.tsx";

interface PostActionsMenuProps {
  post: Post;
  isOwn: boolean;
  onDelete: (post: Post) => void;
  onMute: (post: Post) => void;
  onBlock: (post: Post) => void;
  // Optional: when provided, own posts get an "edit" item above delete.
  onEdit?: (post: Post) => void;
  // Optional: when provided, a REMOTE non-own post gets a "report" item that
  // files an abuse Flag to the author's instance.
  onReport?: (post: Post) => void;
}

const MoreIcon = () => (
  <svg
    class="w-5 h-5"
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
  >
    <circle cx="5" cy="12" r="2" />
    <circle cx="12" cy="12" r="2" />
    <circle cx="19" cy="12" r="2" />
  </svg>
);

// Per-post overflow (⋯) menu: copy link for any post, delete for your own,
// mute/block for others, and report for a REMOTE other's post (files an abuse
// Flag to the author's instance when onReport is wired).
export function PostActionsMenu(props: PostActionsMenuProps) {
  const { t } = useI18n();
  const [open, setOpen] = createSignal(false);
  const [confirmingDelete, setConfirmingDelete] = createSignal(false);
  const [copied, setCopied] = createSignal(false);
  let root: HTMLDivElement | undefined;

  const close = () => {
    setOpen(false);
  };

  const onDocClick = (e: MouseEvent) => {
    if (root && !root.contains(e.target as Node)) close();
  };
  onMount(() => document.addEventListener("click", onDocClick));
  onCleanup(() => document.removeEventListener("click", onDocClick));

  const stop = (e: Event) => e.stopPropagation();

  // A post is remote when its author lives on another host. Reporting notifies
  // the AUTHOR's instance, so it only makes sense for remote content (local
  // abuse is handled by the owner's own moderation tools).
  const isRemote = () => {
    try {
      return new URL(props.post.author.ap_id).host !== globalThis.location.host;
    } catch {
      return false;
    }
  };

  const copyLink = () => {
    const url = `${globalThis.location.origin}/post/${encodeURIComponent(
      props.post.ap_id,
    )}`;
    void navigator.clipboard?.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
    close();
  };

  const itemClass =
    "w-full text-left px-4 py-2.5 text-sm hover:bg-neutral-800 transition-colors";

  return (
    <div class="relative ml-auto" ref={root}>
      <button
        onClick={(e) => {
          stop(e);
          setOpen(!open());
        }}
        aria-label={t("posts.more")}
        aria-haspopup="menu"
        aria-expanded={open()}
        class="flex items-center text-neutral-500 hover:text-neutral-300 transition-colors"
      >
        <MoreIcon />
      </button>

      <Show when={copied()}>
        <span class="absolute right-0 -top-7 whitespace-nowrap px-2 py-1 bg-neutral-800 text-white text-xs rounded-md shadow-lg">
          {t("settings.linkCopied")}
        </span>
      </Show>

      <Show when={open()}>
        <div
          role="menu"
          onClick={stop}
          class="absolute right-0 z-20 mt-1 w-44 rounded-xl border border-neutral-800 bg-neutral-900 shadow-xl overflow-hidden"
        >
          <button role="menuitem" class={itemClass} onClick={copyLink}>
            {t("posts.copyLink")}
          </button>

          <Show when={props.isOwn && props.onEdit}>
            <button
              role="menuitem"
              class={itemClass}
              onClick={() => {
                props.onEdit!(props.post);
                close();
              }}
            >
              {t("posts.edit")}
            </button>
          </Show>

          <Show when={props.isOwn}>
            <button
              role="menuitem"
              class={`${itemClass} text-red-400`}
              onClick={() => {
                setConfirmingDelete(true);
                setOpen(false);
              }}
            >
              {t("common.delete")}
            </button>
          </Show>

          <Show when={!props.isOwn}>
            <button
              role="menuitem"
              class={itemClass}
              onClick={() => {
                props.onMute(props.post);
                close();
              }}
            >
              {t("posts.mute")}
            </button>
            <button
              role="menuitem"
              class={`${itemClass} text-red-400`}
              onClick={() => {
                props.onBlock(props.post);
                close();
              }}
            >
              {t("posts.block")}
            </button>
            <Show when={props.onReport && isRemote()}>
              <button
                role="menuitem"
                class={itemClass}
                onClick={() => {
                  props.onReport!(props.post);
                  close();
                }}
              >
                {t("posts.report")}
              </button>
            </Show>
          </Show>
        </div>
      </Show>

      <ConfirmSheet
        open={confirmingDelete()}
        title={t("confirm.deletePostTitle")}
        body={t("confirm.deletePostBody")}
        confirmLabel={t("common.delete")}
        destructive
        onConfirm={() => {
          props.onDelete(props.post);
          setConfirmingDelete(false);
        }}
        onCancel={() => setConfirmingDelete(false)}
      />
    </div>
  );
}
