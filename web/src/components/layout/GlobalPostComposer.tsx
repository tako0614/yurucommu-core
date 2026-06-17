import { createEffect, createMemo, createSignal, on, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { useAtom, useAtomValue, useSetAtom } from "solid-jotai";
import { actorAtom } from "../../atoms/auth.ts";
import { tAtom } from "../../atoms/i18n.ts";
import { createScopeOpenAtom } from "../../atoms/shell.ts";
import { type InhabitedScope, inhabitedScopeAtom } from "../../atoms/scope.ts";
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
import { CreateScopeModal } from "../scope/CreateScopeModal.tsx";

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
//
// Because re-aiming the audience also moves the inhabited scope, the timeline
// the user came from would otherwise shift silently underneath them. To avoid a
// silent mis-post we snapshot the scope the composer opened on ("the room you're
// viewing") and: (1) surface an explicit hint when the chosen audience differs
// from it, and (2) revert the inhabited scope back to that snapshot if the
// composer closes without a successful post. A successful post commits to the
// chosen room (the user explicitly sent there), so the snapshot is dropped.
function scopesEqual(a: InhabitedScope, b: InhabitedScope): boolean {
  if (a.kind === "community" && b.kind === "community") {
    return a.ap_id === b.ap_id;
  }
  return a.kind === b.kind;
}

export function GlobalPostComposer() {
  const t = useAtomValue(tAtom);
  const navigate = useNavigate();
  const actor = useAtomValue(actorAtom);
  const [showModal] = useAtom(showPostModalAtom);
  const [scope, setScope] = useAtom(inhabitedScopeAtom);
  // Layout-level "create a community" modal, shared with the desktop Sidebar.
  const [createScopeOpen, setCreateScopeOpen] = useAtom(createScopeOpenAtom);

  // The scope the composer was opened on (the timeline the user is viewing).
  // Captured on open so a later audience change can be detected and reverted.
  const [viewingScope, setViewingScope] = createSignal<InhabitedScope | null>(
    null,
  );
  // Set once when a successful post commits to the chosen room, so the
  // close-time revert is skipped (the move was intentional).
  const [committed, setCommitted] = createSignal(false);

  // Snapshot the viewing scope each time the composer opens.
  createEffect(
    on(showModal, (open) => {
      if (open) {
        setViewingScope(scope());
        setCommitted(false);
      }
    }),
  );

  // The chosen audience differs from the room the user is viewing — naming the
  // room they'll be moved to on submit (a community display name, else personal).
  const audienceDiffHint = createMemo(() => {
    const from = viewingScope();
    if (!from || !showModal()) return null;
    const to = scope();
    if (scopesEqual(from, to)) return null;
    const name =
      to.kind === "community"
        ? to.display_name || to.name
        : t()("scope.personal");
    return t()("posts.audienceDiffersFromView").replace("{name}", name);
  });

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
    }).then((ok) => {
      // The send committed the user to the chosen room: keep the inhabited
      // scope there (no close-time revert) so the timeline shows the post.
      if (ok) setCommitted(true);
      return ok || false;
    });
  };

  // Close the composer. If the audience was re-aimed but no post was sent,
  // revert the inhabited scope to the room the user was viewing so opening the
  // composer never silently moves their timeline.
  const handleClose = () => {
    const from = viewingScope();
    if (from && !committed() && !scopesEqual(from, scope())) {
      setScope(from);
    }
    doClosePostModal();
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
            audienceDiffersHint={audienceDiffHint()}
            onClose={handleClose}
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
              so the composer's audience chip updates live. The sheet is mounted
              at layout level here, so without these callbacks "Create a
              community" / "Discover" would fall back to /search. Wire them to
              the shared create modal and the discover surface. */}
          <ScopeSwitcherSheet
            open={scopeSwitcherOpen()}
            onClose={() => setScopeSwitcherOpen(false)}
            onCreate={() => setCreateScopeOpen(true)}
            onDiscover={() => navigate("/search")}
          />
          {/* Shared community composer. Driven by the layout-level atom so the
              desktop Sidebar's "create a community" button opens the same one. */}
          <CreateScopeModal
            open={createScopeOpen()}
            onClose={() => setCreateScopeOpen(false)}
          />
        </>
      )}
    </Show>
  );
}
