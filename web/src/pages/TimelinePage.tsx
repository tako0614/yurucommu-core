import { For, lazy, Show, Suspense } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { useRequiredActor } from "../hooks/useRequiredActor.ts";
import { StoryBar } from "../components/story/StoryBar.tsx";
import { LoadingSpinner } from "../components/LoadingSpinner.tsx";

// Lazy load heavy components
const StoryViewer = lazy(() => import("../components/story/StoryViewer.tsx"));
const StoryComposer = lazy(() =>
  import("../components/story/StoryComposer.tsx")
);
import { InlineErrorBanner } from "../components/InlineErrorBanner.tsx";
import { TimelineHeader } from "../components/timeline/TimelineHeader.tsx";
import { TimelineMobileMenu } from "../components/timeline/TimelineMobileMenu.tsx";
import { TimelinePostItem } from "../components/timeline/TimelinePostItem.tsx";
import { TimelinePostModal } from "../components/timeline/TimelinePostModal.tsx";
import { PluginSlot } from "../components/PluginSlot.tsx";
import { useTimelineState } from "./useTimelineState.ts";

export function TimelinePage() {
  const actor = useRequiredActor();
  const navigate = useNavigate();
  const state = useTimelineState();

  return (
    <div class="flex flex-col h-full">
      <Show when={state.error()}>
        <InlineErrorBanner
          message={state.error()!}
          onClose={state.clearError}
        />
      </Show>
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

      <TimelineMobileMenu
        isOpen={state.showMenu()}
        actor={actor}
        accounts={state.accounts()}
        accountsLoading={state.accountsLoading()}
        currentApId={state.currentApId()}
        showAccountSwitcher={state.showAccountSwitcher()}
        onToggleAccountSwitcher={() =>
          state.setShowAccountSwitcher((prev) => !prev)}
        onSwitchAccount={state.handleSwitchAccount}
        onClose={state.handleCloseMenu}
        t={state.t()}
      />

      <TimelineHeader
        onCreatePost={() => state.setShowPostModal(true)}
        title={state.t()("timeline.title")}
      />

      {/* Story Bar */}
      <StoryBar
        actor={actor}
        actorStories={state.actorStories()}
        loading={state.storiesLoading()}
        onStoryClick={state.handleStoryClick}
        onAddStory={state.handleAddStory}
      />

      <div
        ref={(el) => {
          state.scrollContainerRef = el;
        }}
        class="flex-1 overflow-y-auto"
      >
        <Show
          when={!state.loading()}
          fallback={
            <div class="p-8 text-center text-neutral-500">
              {state.t()("common.loading")}
            </div>
          }
        >
          <Show
            when={state.posts().length > 0}
            fallback={
              <div class="p-8 text-center text-neutral-500">
                {state.t()("timeline.empty")}
              </div>
            }
          >
            <For each={state.posts()}>
              {(post, index) => (
                <div>
                  <TimelinePostItem
                    post={post}
                    onReply={() =>
                      navigate(`/post/${encodeURIComponent(post.ap_id)}`)}
                    onRepost={state.handleRepost}
                    onLike={state.handleLike}
                    onBookmark={state.handleBookmark}
                  />
                  <Show
                    when={index() === 2 ||
                      (index() > 2 && (index() - 2) % 8 === 0)}
                  >
                    <PluginSlot name="timeline.between-posts" />
                  </Show>
                </div>
              )}
            </For>
            <Show when={state.loadingMore()}>
              <div class="p-4 text-center text-neutral-500">
                {state.t()("common.loading")}
              </div>
            </Show>
            <Show when={!state.hasMore() && state.posts().length > 0}>
              <div class="p-4 text-center text-neutral-600 text-sm">
                これ以上の投稿はありません
              </div>
            </Show>
          </Show>
        </Show>
      </div>

      <TimelinePostModal
        isOpen={state.showPostModal()}
        actor={actor}
        postContent={state.postContent()}
        onPostContentChange={state.setPostContent}
        placeholder={state.getPlaceholder()}
        submitLabel={state.t()("posts.post")}
        submittingLabel="投稿中..."
        onClose={state.handleClosePostModal}
        onSubmit={state.handlePost}
        posting={state.posting()}
        fileInputRef={state.fileInputRef}
        onFileSelect={state.handleFileSelect}
        uploadedMedia={state.uploadedMedia()}
        onRemoveMedia={state.removeMedia}
        uploading={state.uploading()}
        uploadError={state.uploadError()}
      />
    </div>
  );
}

export default TimelinePage;
