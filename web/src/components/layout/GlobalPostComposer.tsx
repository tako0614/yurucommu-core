import { Show } from "solid-js";
import { useAtom, useAtomValue, useSetAtom } from "solid-jotai";
import { actorAtom } from "../../atoms/auth.ts";
import { tAtom } from "../../atoms/i18n.ts";
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

// App-shell-level post composer. The composer is opened by the `showPostModalAtom`
// flag, so the IG-like center "Create" affordance works from any route (not just
// the timeline). It binds the same composition atoms the timeline already uses,
// so a created post still lands at the head of the timeline list.
export function GlobalPostComposer() {
  const t = useAtomValue(tAtom);
  const actor = useAtomValue(actorAtom);
  const [showModal] = useAtom(showPostModalAtom);

  const [postContent, setPostContent] = useAtom(postContentAtom);
  const [postSummary, setPostSummary] = useAtom(postSummaryAtom);
  const [postVisibility, setPostVisibility] = useAtom(postVisibilityAtom);
  const posting = useAtomValue(postingAtom);
  const uploadedMedia = useAtomValue(uploadedMediaAtom);
  const uploading = useAtomValue(uploadingAtom);
  const uploadError = useAtomValue(uploadErrorAtom);

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

  const handlePost = (): Promise<boolean> =>
    doCreatePost({
      content: postContent(),
      summary: postSummary(),
      visibility: postVisibility(),
    }).then((ok) => ok || false);

  return (
    <Show when={actor()}>
      {(currentActor) => (
        <TimelinePostModal
          isOpen={showModal()}
          actor={currentActor()}
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
      )}
    </Show>
  );
}
