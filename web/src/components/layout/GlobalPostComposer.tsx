import { createSignal, Show } from "solid-js";
import { useAtom, useAtomValue, useSetAtom } from "solid-jotai";
import { actorAtom } from "../../atoms/auth.ts";
import { tAtom } from "../../atoms/i18n.ts";
import { inhabitedScopeAtom } from "../../atoms/scope.ts";
import {
  closePostModalAtom,
  createPostAtom,
  postContentAtom,
  postSummaryAtom,
  postVisibilityAtom,
  postingAtom,
  removeMediaAtom,
  setMediaAltAtom,
  showPostModalAtom,
  uploadedMediaAtom,
  uploadErrorAtom,
  uploadingAtom,
  uploadMediaAtom,
} from "../../atoms/timeline.ts";
import { TimelinePostModal } from "../timeline/TimelinePostModal.tsx";
import { ScopeSwitcherSheet } from "../scope/ScopeSwitcherSheet.tsx";

// App-shell-level post composer. The composer is opened by the `showPostModalAtom`
// flag, so the IG-like center "Create" affordance works from any route (not just
// the timeline). It binds the same composition atoms the timeline already uses,
// so a created post still lands at the head of the timeline list.
//
// The post audience is seeded from the inhabited scope ("who sees it = what you
// view"): a community scope binds the post to that community (members); personal
// keeps the public/unlisted/followers visibility control. Re-aiming the audience
// from inside the composer opens the ScopeSwitcherSheet, which writes the SAME
// `inhabitedScopeAtom` — so changing the audience also changes the inhabited
// scope, never divergent state.
export function GlobalPostComposer() {
  const t = useAtomValue(tAtom);
  const actor = useAtomValue(actorAtom);
  const [showModal] = useAtom(showPostModalAtom);
  const scope = useAtomValue(inhabitedScopeAtom);

  const [postContent, setPostContent] = useAtom(postContentAtom);
  const [postSummary, setPostSummary] = useAtom(postSummaryAtom);
  const [postVisibility, setPostVisibility] = useAtom(postVisibilityAtom);
  const posting = useAtomValue(postingAtom);
  const uploadedMedia = useAtomValue(uploadedMediaAtom);
  const uploading = useAtomValue(uploadingAtom);
  const uploadError = useAtomValue(uploadErrorAtom);

  // The scope switcher is reachable from inside the composer to re-aim the
  // audience. It is a sibling overlay so it layers above the post modal.
  const [scopeSwitcherOpen, setScopeSwitcherOpen] = createSignal(false);

  const doCreatePost = useSetAtom(createPostAtom);
  const doUploadMedia = useSetAtom(uploadMediaAtom);
  const doRemoveMedia = useSetAtom(removeMediaAtom);
  const doSetMediaAlt = useSetAtom(setMediaAltAtom);
  const doClosePostModal = useSetAtom(closePostModalAtom);

  const handleFileSelect = async (
    e: InputEvent & { currentTarget: HTMLInputElement },
  ) => {
    const input = e.currentTarget;
    const files = input.files;
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      await doUploadMedia(file);
    }
    input.value = "";
  };

  const handlePost = (): Promise<boolean> => {
    const current = scope();
    // A community scope binds the audience to its members; visibility stays at
    // its default (public). Personal forwards the chosen visibility.
    return doCreatePost({
      content: postContent(),
      summary: postSummary(),
      visibility: current.kind === "community" ? "public" : postVisibility(),
      community_ap_id:
        current.kind === "community" ? current.ap_id : undefined,
    }).then((ok) => ok || false);
  };

  return (
    <Show when={actor()}>
      {(currentActor) => (
        <>
          <TimelinePostModal
            isOpen={showModal()}
            actor={currentActor()}
            scope={scope()}
            onOpenScopeSwitcher={() => setScopeSwitcherOpen(true)}
            postContent={postContent()}
            onPostContentChange={setPostContent}
            postSummary={postSummary()}
            onPostSummaryChange={setPostSummary}
            postVisibility={postVisibility()}
            onPostVisibilityChange={setPostVisibility}
            placeholder={t()("posts.placeholder")}
            submitLabel={t()("posts.post")}
            submittingLabel={t()("posts.posting")}
            onClose={doClosePostModal}
            onSubmit={handlePost}
            posting={posting()}
            onFileSelect={handleFileSelect}
            uploadedMedia={uploadedMedia()}
            onRemoveMedia={doRemoveMedia}
            onMediaAltChange={(index, alt) => doSetMediaAlt({ index, alt })}
            uploading={uploading()}
            uploadError={uploadError()}
          />
          {/* Re-aim the audience. Selecting a scope writes inhabitedScopeAtom,
              so the composer's audience chip updates live. */}
          <ScopeSwitcherSheet
            open={scopeSwitcherOpen()}
            onClose={() => setScopeSwitcherOpen(false)}
          />
        </>
      )}
    </Show>
  );
}
