import { For, Show } from "solid-js";
import { Actor, ActorStories } from "../../types/index.ts";
import { useI18n } from "../../lib/i18n.tsx";
import { UserAvatar } from "../UserAvatar.tsx";

interface StoryBarProps {
  actor: Actor;
  actorStories: ActorStories[];
  loading?: boolean;
  onStoryClick: (actorStories: ActorStories, index: number) => void;
  onAddStory: () => void;
}

const PlusIcon = () => (
  <svg
    class="w-3.5 h-3.5"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width={2}
      d="M12 4v16m8-8H4"
    />
  </svg>
);

export function StoryBar(props: StoryBarProps) {
  const { t } = useI18n();
  // Check if current user has any stories
  const myStories = () =>
    props.actorStories.find((as) => as.actor.ap_id === props.actor.ap_id);
  const hasMyStories = () => {
    const ms = myStories();
    return ms && ms.stories.length > 0;
  };

  // Other users' stories (excluding self)
  const otherStories = () =>
    props.actorStories.filter((as) => as.actor.ap_id !== props.actor.ap_id);

  return (
    <Show
      when={!props.loading}
      fallback={
        <div class="px-4 py-3 border-b border-neutral-900">
          <div class="flex gap-4 overflow-x-auto scrollbar-hide">
            <div class="flex flex-col items-center gap-1 flex-shrink-0">
              <div class="w-16 h-16 rounded-full bg-neutral-800 animate-pulse" />
              <div class="w-12 h-3 bg-neutral-800 rounded animate-pulse" />
            </div>
          </div>
        </div>
      }
    >
      <Show
        when={props.actorStories.length > 0 || hasMyStories()}
        fallback={
          <div class="px-4 py-3 border-b border-neutral-900">
            <div class="flex gap-4 overflow-x-auto scrollbar-hide">
              <button
                onClick={props.onAddStory}
                class="flex flex-col items-center gap-1 flex-shrink-0 group"
              >
                <div class="relative">
                  <div class="w-16 h-16 rounded-full ring-2 ring-neutral-700 flex items-center justify-center">
                    <UserAvatar
                      avatarUrl={props.actor.icon_url}
                      name={props.actor.name || props.actor.username}
                      size={60}
                    />
                  </div>
                  <div class="absolute -bottom-0.5 -right-0.5 w-5 h-5 bg-accent rounded-full flex items-center justify-center ring-2 ring-black">
                    <PlusIcon />
                  </div>
                </div>
                <span class="w-16 text-center text-xs leading-tight text-neutral-400 line-clamp-2">
                  {t("story.yourStory")}
                </span>
              </button>
            </div>
          </div>
        }
      >
        <div class="px-4 py-3 border-b border-neutral-900">
          <div class="flex gap-4 overflow-x-auto scrollbar-hide">
            {/* My story / Add story button (always first) */}
            <div class="flex flex-col items-center gap-1 flex-shrink-0">
              <div class="relative">
                {/* Avatar - click to view stories if any */}
                <button
                  onClick={() => {
                    const ms = myStories();
                    if (hasMyStories() && ms) {
                      props.onStoryClick(ms, 0);
                    } else {
                      props.onAddStory();
                    }
                  }}
                  class={`w-16 h-16 rounded-full p-0.5 ${
                    hasMyStories() && myStories()
                      ? myStories()!.has_unviewed
                        ? "bg-gradient-to-tr from-accent to-accent"
                        : "bg-neutral-600"
                      : "ring-2 ring-neutral-700"
                  }`}
                >
                  <div class="w-full h-full rounded-full bg-neutral-900 p-0.5">
                    <UserAvatar
                      avatarUrl={props.actor.icon_url}
                      name={props.actor.name || props.actor.username}
                      size={56}
                    />
                  </div>
                </button>
                {/* + button - always visible, always adds new story */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onAddStory();
                  }}
                  aria-label={t("story.addStory")}
                  title={t("story.addStory")}
                  class="absolute -bottom-0.5 -right-0.5 w-5 h-5 bg-accent rounded-full flex items-center justify-center ring-2 ring-black transition-colors"
                >
                  <PlusIcon />
                </button>
              </div>
              <span class="w-16 text-center text-xs leading-tight text-neutral-400 line-clamp-2">
                {hasMyStories() ? t("story.yourStory") : t("story.addStory")}
              </span>
            </div>

            {/* Other users' stories */}
            <For each={otherStories()}>
              {(as, idx) => (
                <button
                  onClick={() => props.onStoryClick(as, idx())}
                  class="flex flex-col items-center gap-1 flex-shrink-0 group"
                >
                  <div
                    class={`w-16 h-16 rounded-full p-0.5 ${
                      as.has_unviewed
                        ? "bg-gradient-to-tr from-accent to-accent"
                        : "bg-neutral-600"
                    }`}
                  >
                    <div class="w-full h-full rounded-full bg-neutral-900 p-0.5">
                      <UserAvatar
                        avatarUrl={as.actor.icon_url}
                        name={as.actor.name || as.actor.preferred_username}
                        size={56}
                      />
                    </div>
                  </div>
                  <span class="w-16 text-center text-xs leading-tight text-neutral-400 line-clamp-2">
                    {as.actor.name || as.actor.preferred_username}
                  </span>
                </button>
              )}
            </For>
          </div>
        </div>
      </Show>
    </Show>
  );
}
