import { lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRequiredActor } from '../hooks/useRequiredActor';
import { StoryBar } from '../components/story/StoryBar';
import { LoadingSpinner } from '../components/LoadingSpinner';

// Lazy load heavy components
const StoryViewer = lazy(() => import('../components/story/StoryViewer'));
const StoryComposer = lazy(() => import('../components/story/StoryComposer'));
import { InlineErrorBanner } from '../components/InlineErrorBanner';
import { TimelineHeader } from '../components/timeline/TimelineHeader';
import { TimelineMobileMenu } from '../components/timeline/TimelineMobileMenu';
import { TimelinePostItem } from '../components/timeline/TimelinePostItem';
import { TimelinePostModal } from '../components/timeline/TimelinePostModal';
import { PluginSlot } from '../components/PluginSlot';
import { useTimelineState } from './useTimelineState';

export function TimelinePage() {
  const actor = useRequiredActor();
  const navigate = useNavigate();
  const {
    t,
    error,
    clearError,
    fileInputRef,
    scrollContainerRef,
    posts,
    loading,
    loadingMore,
    hasMore,
    postContent,
    setPostContent,
    posting,
    handlePost,
    uploadedMedia,
    uploading,
    uploadError,
    handleFileSelect,
    removeMedia,
    actorStories,
    storiesLoading,
    showStoryViewer,
    setShowStoryViewer,
    storyViewerActorIndex,
    showStoryComposer,
    setShowStoryComposer,
    handleStoryClick,
    handleAddStory,
    handleStorySuccess,
    loadStories,
    showMenu,
    showAccountSwitcher,
    setShowAccountSwitcher,
    handleOpenMenu,
    handleCloseMenu,
    showPostModal,
    setShowPostModal,
    handleClosePostModal,
    accounts,
    accountsLoading,
    currentApId,
    handleSwitchAccount,
    handleLike,
    handleBookmark,
    handleRepost,
    getPlaceholder,
  } = useTimelineState();

  return (
    <div className="flex flex-col h-full">
      {error && (
        <InlineErrorBanner message={error} onClose={clearError} />
      )}
      {/* Story Viewer Modal */}
      {showStoryViewer && actorStories.length > 0 && (
        <Suspense fallback={<LoadingSpinner fullScreen={true} />}>
          <StoryViewer
            actorStories={actorStories}
            initialActorIndex={storyViewerActorIndex}
            onClose={() => {
              setShowStoryViewer(false);
              loadStories(); // Refresh to update viewed status
            }}
          />
        </Suspense>
      )}

      {/* Story Composer Modal */}
      {showStoryComposer && (
        <Suspense fallback={<LoadingSpinner fullScreen={true} />}>
          <StoryComposer
            onClose={() => setShowStoryComposer(false)}
            onSuccess={handleStorySuccess}
          />
        </Suspense>
      )}

      <TimelineMobileMenu
        isOpen={showMenu}
        actor={actor}
        accounts={accounts}
        accountsLoading={accountsLoading}
        currentApId={currentApId}
        showAccountSwitcher={showAccountSwitcher}
        onToggleAccountSwitcher={() => setShowAccountSwitcher((prev) => !prev)}
        onSwitchAccount={handleSwitchAccount}
        onClose={handleCloseMenu}
        t={t}
      />

      <TimelineHeader
        onCreatePost={() => setShowPostModal(true)}
        title={t('timeline.title')}
      />

      {/* Story Bar */}
      <StoryBar
        actor={actor}
        actorStories={actorStories}
        loading={storiesLoading}
        onStoryClick={handleStoryClick}
        onAddStory={handleAddStory}
      />

      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-8 text-center text-neutral-500">{t('common.loading')}</div>
        ) : posts.length === 0 ? (
          <div className="p-8 text-center text-neutral-500">{t('timeline.empty')}</div>
        ) : (
          <>
            {posts.map((post, index) => (
              <div key={post.ap_id}>
                <TimelinePostItem
                  post={post}
                  onReply={() => navigate(`/post/${encodeURIComponent(post.ap_id)}`)}
                  onRepost={handleRepost}
                  onLike={handleLike}
                  onBookmark={handleBookmark}
                />
                {(index === 2 || (index > 2 && (index - 2) % 8 === 0)) && (
                  <PluginSlot name="timeline.between-posts" />
                )}
              </div>
            ))}            {loadingMore && <div className="p-4 text-center text-neutral-500">{t('common.loading')}</div>}
            {!hasMore && posts.length > 0 && <div className="p-4 text-center text-neutral-600 text-sm">これ以上の投稿はありません</div>}
          </>
        )}
      </div>

      <TimelinePostModal
        isOpen={showPostModal}
        actor={actor}
        postContent={postContent}
        onPostContentChange={setPostContent}
        placeholder={getPlaceholder()}
        submitLabel={t('posts.post')}
        submittingLabel="投稿中..."
        onClose={handleClosePostModal}
        onSubmit={handlePost}
        posting={posting}
        fileInputRef={fileInputRef}
        onFileSelect={handleFileSelect}
        uploadedMedia={uploadedMedia}
        onRemoveMedia={removeMedia}
        uploading={uploading}
        uploadError={uploadError}
      />
    </div>
  );
}

export default TimelinePage;
