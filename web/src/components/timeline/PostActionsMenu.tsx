import { createSignal, onCleanup, onMount, Show } from "solid-js";
import type { Post } from "../../types/index.ts";
import { useI18n } from "../../lib/i18n.tsx";

interface PostActionsMenuProps {
  post: Post;
  isOwn: boolean;
  onDelete: (post: Post) => void;
  onMute: (post: Post) => void;
  onBlock: (post: Post) => void;
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
// mute/block for others. Report is omitted until a report API exists.
export function PostActionsMenu(props: PostActionsMenuProps) {
  const { t } = useI18n();
  const [open, setOpen] = createSignal(false);
  const [confirmingDelete, setConfirmingDelete] = createSignal(false);
  const [copied, setCopied] = createSignal(false);
  let root: HTMLDivElement | undefined;

  const close = () => {
    setOpen(false);
    setConfirmingDelete(false);
  };

  const onDocClick = (e: MouseEvent) => {
    if (root && !root.contains(e.target as Node)) close();
  };
  onMount(() => document.addEventListener("click", onDocClick));
  onCleanup(() => document.removeEventListener("click", onDocClick));

  const stop = (e: Event) => e.stopPropagation();

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
        aria-label="More"
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

          <Show when={props.isOwn}>
            <Show
              when={confirmingDelete()}
              fallback={
                <button
                  role="menuitem"
                  class={`${itemClass} text-red-400`}
                  onClick={() => setConfirmingDelete(true)}
                >
                  {t("common.delete")}
                </button>
              }
            >
              <div class="px-4 py-2.5 border-t border-neutral-800">
                <p class="text-xs text-neutral-400 mb-2">
                  {t("posts.deleteConfirm")}
                </p>
                <div class="flex gap-2">
                  <button
                    class="flex-1 px-2 py-1 text-xs rounded-md bg-red-500 hover:bg-red-600 text-white transition-colors"
                    onClick={() => {
                      props.onDelete(props.post);
                      close();
                    }}
                  >
                    {t("common.delete")}
                  </button>
                  <button
                    class="flex-1 px-2 py-1 text-xs rounded-md bg-neutral-700 hover:bg-neutral-600 text-white transition-colors"
                    onClick={() => setConfirmingDelete(false)}
                  >
                    {t("common.cancel")}
                  </button>
                </div>
              </div>
            </Show>
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
          </Show>
        </div>
      </Show>
    </div>
  );
}
