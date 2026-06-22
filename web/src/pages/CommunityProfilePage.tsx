import { createEffect, createSignal, on, onCleanup, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { useNavigate, useParams } from "@solidjs/router";
import { useRequiredActor } from "../hooks/useRequiredActor.ts";
import { ApiError } from "../lib/api/fetch.ts";
import { useDialog } from "../lib/useDialog.ts";
import { enterCommunityScopeAtom } from "../atoms/scope.ts";
import {
  acceptCommunityJoinRequest,
  CommunityDetail,
  CommunityJoinRequest,
  CommunitySettings,
  createCommunityInvite,
  fetchCommunity,
  fetchCommunityJoinRequests,
  fetchCommunityMembers,
  joinCommunity,
  leaveCommunity,
  rejectCommunityJoinRequest,
  updateCommunityMemberRole,
  updateCommunitySettings,
  uploadMedia,
} from "../lib/api.ts";
import { useI18n } from "../lib/i18n.tsx";
import { useSetAtom } from "solid-jotai";
import { pushToast, toastsAtom } from "../atoms/toast.ts";
import { ConfirmSheet } from "../components/ConfirmSheet.tsx";
import { InlineErrorBanner } from "../components/InlineErrorBanner.tsx";
import { CommunityProfileHeader } from "../components/community/CommunityProfileHeader.tsx";
import { CommunityProfileSummary } from "../components/community/CommunityProfileSummary.tsx";
import { CommunityAboutPanel } from "../components/community/CommunityAboutPanel.tsx";
import { CommunityMembersPanel } from "../components/community/CommunityMembersPanel.tsx";
import { CommunitySettingsPanel } from "../components/community/CommunitySettingsPanel.tsx";
import type { CommunityMember } from "../lib/api/communities.ts";

export function CommunityProfilePage() {
  const actor = useRequiredActor();
  const { t } = useI18n();
  const setToasts = useSetAtom(toastsAtom);
  const enterCommunityScope = useSetAtom(enterCommunityScopeAtom);
  const [error, setError] = createSignal<string | null>(null);
  const clearError = () => setError(null);
  // Styled invite-code prompt (replaces window.prompt for invite-only joins).
  const [invitePromptOpen, setInvitePromptOpen] = createSignal(false);
  const [inviteInput, setInviteInput] = createSignal("");
  // Pending join-request action, staged so the shared ConfirmSheet can gate it.
  const [pendingRequest, setPendingRequest] = createSignal<{
    request: CommunityJoinRequest;
    action: "accept" | "reject";
  } | null>(null);
  // Leave action staged so the shared ConfirmSheet can gate the destructive op.
  const [confirmLeave, setConfirmLeave] = createSignal(false);
  // Owner-promotion staged behind a confirm (a privilege transfer).
  const [pendingOwnerPromotion, setPendingOwnerPromotion] =
    createSignal<CommunityMember | null>(null);
  const params = useParams();
  const navigate = useNavigate();
  const [community, setCommunity] = createSignal<CommunityDetail | null>(null);
  const [members, setMembers] = createSignal<CommunityMember[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [activeTab, setActiveTab] = createSignal<
    "about" | "members" | "settings"
  >("about");
  const [joining, setJoining] = createSignal(false);
  const [joinRequests, setJoinRequests] = createSignal<CommunityJoinRequest[]>(
    [],
  );
  const [loadingRequests, setLoadingRequests] = createSignal(false);
  const [inviteCode, setInviteCode] = createSignal<string | null>(null);
  const [creatingInvite, setCreatingInvite] = createSignal(false);
  const [requestAction, setRequestAction] = createSignal<
    Record<string, boolean>
  >({});
  const [memberActionError, setMemberActionError] = createSignal<string | null>(
    null,
  );
  const [updatingMemberRole, setUpdatingMemberRole] = createSignal<
    Record<string, boolean>
  >({});
  // Settings state
  const [settingsForm, setSettingsForm] = createSignal<CommunitySettings>({});
  const [savingSettings, setSavingSettings] = createSignal(false);
  const [settingsError, setSettingsError] = createSignal<string | null>(null);
  const [uploadingIcon, setUploadingIcon] = createSignal(false);
  const [iconPreview, setIconPreview] = createSignal<string | null>(null);

  // Cleanup iconPreview ObjectURL on unmount
  onCleanup(() => {
    const preview = iconPreview();
    if (preview) {
      URL.revokeObjectURL(preview);
    }
  });

  // Esc / backdrop handling for the invite-code prompt sheet.
  let invitePromptRef: HTMLFormElement | undefined;
  useDialog({
    isOpen: () => invitePromptOpen(),
    onClose: () => setInvitePromptOpen(false),
    container: () => invitePromptRef,
  });

  // Track ONLY the route param. `loadCommunity()` reads `community()` synchronously
  // (before its first await) to decide the loading state, so running it inside a
  // bare createEffect would make the effect depend on `community()` — and its own
  // `setCommunity(data)` would then re-trigger it forever (observed: an infinite
  // refetch loop that hammered the API into 429). `on(() => params.name, …)` runs
  // the callback untracked, so the reload fires once per community, not per fetch.
  createEffect(
    on(
      () => params.name,
      (name) => {
        if (!name) return;
        setCommunity(null);
        setMembers([]);
        setJoinRequests([]);
        setActiveTab("about");
        setError(null);
        setInviteCode(null);
        setLoading(true);
        loadCommunity();
      },
    ),
  );

  // Generation guard: a fast community→community navigation must not let a slow
  // prior load (3 sequential fetches) land its data under the new community.
  let communityLoadGen = 0;
  const loadCommunity = async () => {
    const name = params.name;
    if (!name) return;
    const gen = ++communityLoadGen;
    // Only show loading if no cached data
    if (!community()) setLoading(true);
    try {
      const data = await fetchCommunity(name);
      if (gen !== communityLoadGen) return;
      setCommunity(data);
      const membersData = await fetchCommunityMembers(name);
      if (gen !== communityLoadGen) return;
      setMembers(membersData);
      const canManageNow =
        data.member_role === "owner" || data.member_role === "moderator";
      if (canManageNow) {
        setLoadingRequests(true);
        try {
          const requestsData = await fetchCommunityJoinRequests(name);
          if (gen !== communityLoadGen) return;
          setJoinRequests(requestsData);
        } finally {
          setLoadingRequests(false);
        }
      } else {
        setJoinRequests([]);
      }
    } catch (e) {
      if (gen !== communityLoadGen) return;
      console.error("Failed to load community:", e);
      // A 404 is a genuine not-found; the dedicated empty state already covers
      // that (community() stays null). Other failures are surfaced as an error
      // banner so they aren't silently collapsed into "not found".
      if (!(e instanceof ApiError && e.status === 404)) {
        setError(t("common.error"));
      }
    } finally {
      if (gen === communityLoadGen) setLoading(false);
    }
  };

  const handleJoin = async () => {
    const comm = community();
    if (!comm || joining()) return;
    // Invite-only communities need a code: open the styled prompt sheet instead
    // of a raw window.prompt. The sheet's submit calls runJoin with the code.
    if (comm.join_policy === "invite") {
      setInviteInput("");
      setInvitePromptOpen(true);
      return;
    }
    await runJoin();
  };

  const submitInviteJoin = async (e: Event) => {
    e.preventDefault();
    const code = inviteInput().trim();
    if (!code || joining()) return;
    setInvitePromptOpen(false);
    await runJoin(code);
  };

  const runJoin = async (inviteId?: string) => {
    const comm = community();
    if (!comm || joining()) return;
    setJoining(true);
    try {
      const result = await joinCommunity(comm.name, { inviteId });
      if (result.status === "pending") {
        setCommunity((prev) =>
          prev ? { ...prev, join_status: "pending" } : null,
        );
      } else {
        const updated: CommunityDetail | null = community()
          ? {
              ...community()!,
              is_member: true,
              member_role: community()!.member_role ?? "member",
              join_status: null,
              member_count: community()!.member_count + 1,
            }
          : null;
        setCommunity(updated);
        // Parity with the discovery-surface join: stand in the community just
        // joined so it becomes the active inhabited scope (a new ScopeBar pill).
        if (updated) await enterCommunityScope(updated);
      }
    } catch (e) {
      console.error("Failed to join:", e);
      setError(t("common.error"));
    } finally {
      setJoining(false);
    }
  };

  const handleLeave = async () => {
    const comm = community();
    if (!comm || joining()) return;
    setJoining(true);
    try {
      await leaveCommunity(comm.name);
      setCommunity((prev) =>
        prev
          ? { ...prev, is_member: false, member_count: prev.member_count - 1 }
          : null,
      );
    } catch (e) {
      console.error("Failed to leave:", e);
      setError(t("common.error"));
    } finally {
      setJoining(false);
      setConfirmLeave(false);
    }
  };

  // Panel buttons stage the action; the shared ConfirmSheet runs it.
  const handleAcceptRequest = (request: CommunityJoinRequest) => {
    if (requestAction()[request.ap_id]) return;
    setPendingRequest({ request, action: "accept" });
  };

  const handleRejectRequest = (request: CommunityJoinRequest) => {
    if (requestAction()[request.ap_id]) return;
    setPendingRequest({ request, action: "reject" });
  };

  const confirmRequest = async () => {
    const pending = pendingRequest();
    setPendingRequest(null);
    if (!pending) return;
    if (pending.action === "accept") {
      await runAcceptRequest(pending.request);
    } else {
      await runRejectRequest(pending.request);
    }
  };

  const runAcceptRequest = async (request: CommunityJoinRequest) => {
    const comm = community();
    if (!comm) return;
    if (requestAction()[request.ap_id]) return;
    setRequestAction((prev) => ({ ...prev, [request.ap_id]: true }));
    try {
      await acceptCommunityJoinRequest(comm.name, request.ap_id);
      setJoinRequests((prev) => prev.filter((r) => r.ap_id !== request.ap_id));
      const membersData = await fetchCommunityMembers(comm.name);
      setMembers(membersData);
      setCommunity((prev) =>
        prev ? { ...prev, member_count: prev.member_count + 1 } : null,
      );
      pushToast(setToasts, t("feedback.requestApproved"), { kind: "success" });
    } catch (e) {
      console.error("Failed to accept join request:", e);
      pushToast(setToasts, t("feedback.actionFailed"), { kind: "error" });
    } finally {
      setRequestAction((prev) => ({ ...prev, [request.ap_id]: false }));
    }
  };

  const runRejectRequest = async (request: CommunityJoinRequest) => {
    const comm = community();
    if (!comm) return;
    if (requestAction()[request.ap_id]) return;
    setRequestAction((prev) => ({ ...prev, [request.ap_id]: true }));
    try {
      await rejectCommunityJoinRequest(comm.name, request.ap_id);
      setJoinRequests((prev) => prev.filter((r) => r.ap_id !== request.ap_id));
      pushToast(setToasts, t("feedback.requestRejected"), { kind: "success" });
    } catch (e) {
      console.error("Failed to reject join request:", e);
      pushToast(setToasts, t("feedback.actionFailed"), { kind: "error" });
    } finally {
      setRequestAction((prev) => ({ ...prev, [request.ap_id]: false }));
    }
  };

  const handleCreateInvite = async () => {
    const comm = community();
    if (!comm || creatingInvite()) return;
    setCreatingInvite(true);
    try {
      const result = await createCommunityInvite(comm.name);
      setInviteCode(result.invite_id);
    } catch (e) {
      console.error("Failed to create invite:", e);
      setError(t("common.error"));
    } finally {
      setCreatingInvite(false);
    }
  };

  const handleUpdateMemberRole = (
    member: CommunityMember,
    role: "owner" | "moderator" | "member",
  ) => {
    // Promoting to owner is a privilege transfer — stage it behind a confirm
    // rather than acting on the first click.
    if (role === "owner") {
      setPendingOwnerPromotion(member);
      return;
    }
    void doUpdateMemberRole(member, role);
  };

  const doUpdateMemberRole = async (
    member: CommunityMember,
    role: "owner" | "moderator" | "member",
  ) => {
    const comm = community();
    if (!comm) return;
    if (member.role === role || updatingMemberRole()[member.ap_id]) return;
    setMemberActionError(null);
    setUpdatingMemberRole((prev) => ({ ...prev, [member.ap_id]: true }));
    try {
      await updateCommunityMemberRole(comm.name, member.ap_id, role);
      setMembers((prev) =>
        prev.map((m) => (m.ap_id === member.ap_id ? { ...m, role } : m)),
      );
      if (member.ap_id === actor.ap_id) {
        setCommunity((prev) => (prev ? { ...prev, member_role: role } : prev));
      }
    } catch (e) {
      console.error("Failed to update member role:", e);
      setMemberActionError(t("common.error"));
    } finally {
      setUpdatingMemberRole((prev) => ({ ...prev, [member.ap_id]: false }));
    }
  };

  // Seed the settings form when the community IDENTITY changes (first load or
  // navigating to a different community) — NOT on every `community()` object
  // identity change. The latter re-ran on any sibling mutation that produces a
  // fresh community object (join / leave / accept-request bumping member_count
  // / save-settings), silently overwriting unsaved edits a manager had typed in
  // the settings tab. Keying on `ap_id` re-seeds only on a real community switch.
  createEffect(
    on(
      () => community()?.ap_id,
      () => {
        const comm = community();
        if (comm) {
          setSettingsForm({
            display_name: comm.display_name || comm.name,
            summary: comm.summary || "",
            visibility: comm.visibility,
            join_policy: comm.join_policy,
            post_policy: comm.post_policy,
          });
        }
      },
    ),
  );

  const handleIconUpload = async (
    e: Event & { currentTarget: HTMLInputElement },
  ) => {
    const file = e.currentTarget.files?.[0];
    if (!file || uploadingIcon()) return;

    setUploadingIcon(true);
    try {
      const result = await uploadMedia(file);
      setSettingsForm((prev) => ({ ...prev, icon_url: result.url }));
      // Revoke old ObjectURL before creating a new one
      const oldPreview = iconPreview();
      if (oldPreview) {
        URL.revokeObjectURL(oldPreview);
      }
      setIconPreview(URL.createObjectURL(file));
    } catch {
      setSettingsError(t("community.iconUploadFailed"));
    } finally {
      setUploadingIcon(false);
    }
  };

  const handleSaveSettings = async () => {
    const comm = community();
    if (!comm || savingSettings()) return;
    setSavingSettings(true);
    setSettingsError(null);
    try {
      const normalizedSettings: CommunitySettings = {
        ...settingsForm(),
        display_name:
          settingsForm().display_name !== undefined
            ? settingsForm().display_name!.trim()
            : undefined,
        summary:
          settingsForm().summary !== undefined
            ? settingsForm().summary!.trim()
            : undefined,
      };
      await updateCommunitySettings(comm.name, normalizedSettings);
      // Update local community state
      setCommunity((prev) =>
        prev
          ? {
              ...prev,
              display_name:
                normalizedSettings.display_name ?? prev.display_name,
              summary: normalizedSettings.summary ?? prev.summary,
              icon_url: normalizedSettings.icon_url ?? prev.icon_url,
              visibility: normalizedSettings.visibility ?? prev.visibility,
              join_policy: normalizedSettings.join_policy ?? prev.join_policy,
              post_policy: normalizedSettings.post_policy ?? prev.post_policy,
            }
          : null,
      );
      // Cleanup ObjectURL and clear preview after successful save
      const preview = iconPreview();
      if (preview) {
        URL.revokeObjectURL(preview);
      }
      setIconPreview(null);
      pushToast(setToasts, t("feedback.settingsSaved"), { kind: "success" });
    } catch {
      setSettingsError(t("feedback.settingsFailed"));
      pushToast(setToasts, t("feedback.settingsFailed"), { kind: "error" });
    } finally {
      setSavingSettings(false);
    }
  };

  const canManage = () =>
    community()?.member_role === "owner" ||
    community()?.member_role === "moderator";
  const isOwner = () => community()?.member_role === "owner";

  return (
    <div class="flex flex-col h-full">
      <Show when={error()}>
        <InlineErrorBanner message={error()!} onClose={clearError} />
      </Show>

      <Show when={loading()}>
        <CommunityProfileHeader
          title={t("groups.title")}
          subtitle=""
          onBack={() => navigate(-1)}
        />
        <div class="p-8 text-center text-neutral-500">
          {t("common.loading")}
        </div>
      </Show>

      {/* Genuine not-found (404 leaves community() null without an error). */}
      <Show when={!loading() && !community() && !error()}>
        <CommunityProfileHeader
          title={t("groups.title")}
          subtitle=""
          onBack={() => navigate(-1)}
        />
        <div class="p-8 text-center text-neutral-500">
          {t("community.notFound")}
        </div>
      </Show>

      {/* Transient (non-404) failure: offer a retry instead of "not found". */}
      <Show when={!loading() && !community() && error()}>
        <CommunityProfileHeader
          title={t("groups.title")}
          subtitle=""
          onBack={() => navigate(-1)}
        />
        <div class="flex flex-col items-center gap-3 p-8 text-center">
          <div class="text-neutral-400">{error()}</div>
          <button
            type="button"
            onClick={() => {
              clearError();
              setLoading(true);
              loadCommunity();
            }}
            class="rounded-full bg-neutral-800 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-700"
          >
            {t("common.retry")}
          </button>
        </div>
      </Show>

      <Show when={!loading() && community()}>
        <CommunityProfileHeader
          title={community()!.display_name || community()!.name}
          subtitle={t("community.members").replace(
            "{count}",
            String(community()!.member_count),
          )}
          onBack={() => navigate(-1)}
        />

        <div class="flex-1 overflow-y-auto">
          <CommunityProfileSummary
            community={community()!}
            joining={joining()}
            onJoin={handleJoin}
            onLeave={() => setConfirmLeave(true)}
            chatPath={`/dm?c=${encodeURIComponent(community()!.ap_id)}`}
          />
          {/* Tabs */}
          <div class="border-b border-neutral-900 flex">
            <button
              onClick={() => setActiveTab("about")}
              class={`flex-1 py-4 text-center font-bold transition-colors relative ${
                activeTab() === "about"
                  ? "text-white"
                  : "text-neutral-500 hover:bg-neutral-900/50"
              }`}
            >
              {t("community.tabAbout")}
              <Show when={activeTab() === "about"}>
                <div class="absolute bottom-0 left-1/2 -translate-x-1/2 w-16 h-1 bg-accent rounded-full" />
              </Show>
            </button>
            <button
              onClick={() => setActiveTab("members")}
              class={`flex-1 py-4 text-center font-bold transition-colors relative ${
                activeTab() === "members"
                  ? "text-white"
                  : "text-neutral-500 hover:bg-neutral-900/50"
              }`}
            >
              {t("members.title")}
              <Show when={activeTab() === "members"}>
                <div class="absolute bottom-0 left-1/2 -translate-x-1/2 w-16 h-1 bg-accent rounded-full" />
              </Show>
            </button>
            <Show when={canManage()}>
              <button
                onClick={() => setActiveTab("settings")}
                class={`flex-1 py-4 text-center font-bold transition-colors relative ${
                  activeTab() === "settings"
                    ? "text-white"
                    : "text-neutral-500 hover:bg-neutral-900/50"
                }`}
              >
                {t("nav.settings")}
                <Show when={activeTab() === "settings"}>
                  <div class="absolute bottom-0 left-1/2 -translate-x-1/2 w-16 h-1 bg-accent rounded-full" />
                </Show>
              </button>
            </Show>
          </div>

          {/* Content */}
          <Show when={activeTab() === "about"}>
            <CommunityAboutPanel community={community()!} />
          </Show>
          <Show when={activeTab() === "members"}>
            <CommunityMembersPanel
              members={members()}
              joinRequests={joinRequests()}
              canManage={canManage()}
              isOwner={isOwner()}
              loadingRequests={loadingRequests()}
              requestAction={requestAction()}
              memberActionError={memberActionError()}
              updatingMemberRole={updatingMemberRole()}
              inviteCode={inviteCode()}
              creatingInvite={creatingInvite()}
              joinPolicy={community()!.join_policy}
              actorApId={actor.ap_id}
              onAcceptRequest={handleAcceptRequest}
              onRejectRequest={handleRejectRequest}
              onUpdateMemberRole={handleUpdateMemberRole}
              onCreateInvite={handleCreateInvite}
              t={t}
            />
          </Show>
          <Show when={activeTab() === "settings" && canManage()}>
            <CommunitySettingsPanel
              community={community()!}
              settingsForm={settingsForm()}
              settingsError={settingsError()}
              savingSettings={savingSettings()}
              uploadingIcon={uploadingIcon()}
              iconPreview={iconPreview()}
              onChangeSettings={(updater) =>
                setSettingsForm((prev) => updater(prev))
              }
              onUploadIcon={handleIconUpload}
              onSaveSettings={handleSaveSettings}
            />
          </Show>
        </div>
      </Show>
      <ConfirmSheet
        open={pendingRequest() !== null}
        title={
          pendingRequest()?.action === "reject"
            ? t("confirm.rejectRequestTitle")
            : t("confirm.approveRequestTitle")
        }
        confirmLabel={
          pendingRequest()?.action === "reject"
            ? t("dm.reject")
            : t("common.confirm")
        }
        destructive={pendingRequest()?.action === "reject"}
        onConfirm={confirmRequest}
        onCancel={() => setPendingRequest(null)}
      />
      <ConfirmSheet
        open={confirmLeave()}
        title={t("groups.leaveConfirmTitle")}
        body={t("groups.leaveConfirmBody")}
        confirmLabel={t("groups.leave")}
        destructive
        busy={joining()}
        onConfirm={handleLeave}
        onCancel={() => setConfirmLeave(false)}
      />
      <ConfirmSheet
        open={pendingOwnerPromotion() !== null}
        title={t("community.makeOwnerTitle")}
        body={t("community.makeOwnerBody")}
        destructive
        onConfirm={() => {
          const member = pendingOwnerPromotion();
          setPendingOwnerPromotion(null);
          if (member) void doUpdateMemberRole(member, "owner");
        }}
        onCancel={() => setPendingOwnerPromotion(null)}
      />
      <Show when={invitePromptOpen()}>
        <Portal>
          <div
            class="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
            onClick={(e) => {
              if (e.target === e.currentTarget) setInvitePromptOpen(false);
            }}
          >
            <form
              ref={invitePromptRef}
              role="dialog"
              aria-modal="true"
              aria-label={t("community.joinWithInvite")}
              onSubmit={submitInviteJoin}
              class="w-full max-w-sm rounded-t-2xl border border-neutral-800 bg-neutral-900 p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl sm:rounded-2xl sm:pb-5"
            >
              <h2 class="text-base font-bold text-white">
                {t("community.joinWithInvite")}
              </h2>
              <div class="mt-4">
                <label
                  for="community-invite-code"
                  class="mb-1 block text-sm font-medium text-neutral-300"
                >
                  {t("members.inviteCode")}
                </label>
                <input
                  id="community-invite-code"
                  type="text"
                  value={inviteInput()}
                  onInput={(e) => setInviteInput(e.currentTarget.value)}
                  placeholder={t("community.inviteCodePlaceholder")}
                  autocomplete="off"
                  autocapitalize="off"
                  spellcheck={false}
                  disabled={joining()}
                  class="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-white outline-none placeholder-neutral-600 focus:border-[var(--accent)] disabled:opacity-50"
                />
              </div>
              <div class="mt-5 flex gap-2">
                <button
                  type="button"
                  onClick={() => setInvitePromptOpen(false)}
                  disabled={joining()}
                  class="flex-1 rounded-full bg-neutral-800 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-neutral-700 disabled:opacity-50"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="submit"
                  disabled={!inviteInput().trim() || joining()}
                  class="flex-1 rounded-full bg-[var(--accent)] px-4 py-2.5 text-sm font-bold text-white transition-colors hover:brightness-110 disabled:opacity-50"
                >
                  {t("community.joinWithInvite")}
                </button>
              </div>
            </form>
          </div>
        </Portal>
      </Show>
    </div>
  );
}

export default CommunityProfilePage;
