import { createSignal, For, lazy, Show, Suspense } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { useRequiredActor } from "../hooks/useRequiredActor.ts";
import { StoryBar } from "../components/story/StoryBar.tsx";
import { ScopeHeader } from "../components/scope/ScopeHeader.tsx";
import { ScopeBar } from "../components/scope/ScopeBar.tsx";
import { ScopeSwitcherSheet } from "../components/scope/ScopeSwitcherSheet.tsx";
import { CreateScopeModal } from "../components/scope/CreateScopeModal.tsx";
import { LoadingSpinner } from "../components/LoadingSpinner.tsx";

// Lazy load heavy components
const StoryViewer = lazy(() => import("../components/story/StoryViewer.tsx"));
const StoryComposer = lazy(
  () => import("../components/story/StoryComposer.tsx"),
);
import { InlineErrorRetry } from "../components/InlineErrorRetry.tsx";
import { FirstFeedEmptyState } from "../components/FirstFeedEmptyState.tsx";
import { TimelinePostItem } from "../components/timeline/TimelinePostItem.tsx";
import { PostSkeleton } from "../components/timeline/PostSkeleton.tsx";
import { PluginSlot } from "../components/PluginSlot.tsx";
import { useTimelineState } from "./useTimelineState.ts";

export function TimelinePage() {
  const actor = useRequiredActor();
  const navigate = useNavigate();
  const state = useTimelineState();

  // Shared open state for the scope switcher sheet — both the ScopeHeader pill
  // and the ScopeBar's trailing "+" drive the same instance.
  const [switcherOpen, setSwitcherOpen] = createSignal(false);
  // The switcher's "Create" row hands off to the community composer; discovery
  // routes to /search where non-member communities can be joined one-tap.
  const [createOpen, setCreateOpen] = createSignal(false);

  return (
    <div class="relative flex flex-col h-full">
      {/* Story Viewer Modal */}
      <Show when={state.showStoryViewer() && state.actorStories().length > 0}>
        <Suspense fallback={<LoadingSpinner fullScreen={true} />}>
          <StoryViewer
            actorStories={state.actorStories()}
            initialActorIndex={state.storyViewerActorIndex()}
            onClose={() => {
              state.setShowStoryViewer(false);
              state.loadStories(); // Refresh to update viewed status
            }}
          />
        </Suspense>
      </Show>

      {/* Story Composer Modal */}
      <Show when={state.showStoryComposer()}>
        <Suspense fallback={<LoadingSpinner fullScreen={true} />}>
          <StoryComposer
            onClose={() => state.setShowStoryComposer(false)}
            onSuccess={state.handleStorySuccess}
          />
        </Suspense>
      </Show>

      {/* Scope identity + ambient reach + DM/notify/compose (replaces the
          plain timeline title and absorbs the mobile shell header). */}
      <ScopeHeader onOpenSwitcher={() => setSwitcherOpen(true)} />

      {/* Story Bar */}
      <StoryBar
        actor={actor}
        actorStories={state.actorStories()}
        loading={state.storiesLoading()}
        onStoryClick={state.handleStoryClick}
        onAddStory={state.handleAddStory}
      />

      {/* One-tap inhabited-scope rail (second projection of the scope atom). */}
      <ScopeBar onOpenSwitcher={() => setSwitcherOpen(true)} />

      {/* Scope switcher sheet, shared by the header pill and the rail's "+".
          Discover routes to /search; Create opens the community composer. */}
      <ScopeSwitcherSheet
        open={switcherOpen()}
        onClose={() => setSwitcherOpen(false)}
        onDiscover={() => navigate("/search")}
        onCreate={() => setCreateOpen(true)}
      />

      {/* Community composer — the first caller of createCommunity(). On success
          it selects the new community as the inhabited scope. */}
      <CreateScopeModal
        open={createOpen()}
        onClose={() => setCreateOpen(false)}
      />

      {/* New-posts pill — prepends staged head posts and scrolls to top. */}
      <Show when={state.newPostsCount() > 0}>
        <div class="pointer-events-none absolute inset-x-0 top-16 z-20 flex justify-center">
          <button
            onClick={state.handleShowNewPosts}
            class="pointer-events-auto flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-bold text-white shadow-lg transition-colors"
          >
            <svg
              class="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width={2}
                d="M5 15l7-7 7 7"
              />
            </svg>
            {state
              .t()("timeline.newPosts")
              .replace("{count}", String(state.newPostsCount()))}
          </button>
        </div>
      </Show>

      <div
        ref={(el) => {
          state.scrollContainerRef = el;
        }}
        class="flex-1 overflow-y-auto"
      >
        <Show
          when={!(state.loadError() && state.posts().length === 0)}
          fallback={
            <InlineErrorRetry
              message={state.loadError()!}
              retryLabel={state.t()("common.retry")}
              onRetry={state.loadTimeline}
            />
          }
        >
          <Show
            when={!(state.loading() && state.posts().length === 0)}
            fallback={<PostSkeleton count={6} />}
          >
            <Show
              when={state.posts().length > 0}
              fallback={
                <FirstFeedEmptyState
                  onCreateStory={state.handleAddStory}
                  onCreateCommunity={() => setCreateOpen(true)}
                  onDiscoverCommunities={() => navigate("/search")}
                />
              }
            >
              <For each={state.posts()}>
                {(post, index) => (
                  <div>
                    <TimelinePostItem
                      post={post}
                      onReply={() =>
                        navigate(`/post/${encodeURIComponent(post.ap_id)}`)
                      }
                      onRepost={state.handleRepost}
                      onLike={state.handleLike}
                      onBookmark={state.handleBookmark}
                      currentActorApId={actor.ap_id}
                      onDelete={state.handleDelete}
                      onMute={state.handleMute}
                      onBlock={state.handleBlock}
                    />
                    <Show
                      when={
                        index() === 2 ||
                        (index() > 2 && (index() - 2) % 8 === 0)
                      }
                    >
                      <PluginSlot name="timeline.between-posts" />
                    </Show>
                  </div>
                )}
              </For>
              {/* Auto-load sentinel: observed by IntersectionObserver. */}
              <div
                ref={(el) => {
                  state.loadMoreSentinelRef = el;
                }}
                class="h-px w-full"
                aria-hidden="true"
              />
              <Show when={state.loadingMore()}>
                <div
                  class="flex justify-center py-4"
                  role="status"
                  aria-label={state.t()("common.loading")}
                >
                  <div class="w-6 h-6 border-2 border-neutral-700 border-t-neutral-400 rounded-full animate-spin" />
                </div>
              </Show>
              <Show when={!state.hasMore() && state.posts().length > 0}>
                <div class="p-4 text-center text-neutral-600 text-sm">
                  {state.t()("timeline.noMorePosts")}
                </div>
              </Show>
            </Show>
          </Show>
        </Show>
      </div>
    </div>
  );
}

export default TimelinePage;
