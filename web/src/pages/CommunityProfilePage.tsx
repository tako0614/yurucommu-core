import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { useNavigate, useParams } from "@solidjs/router";
import { useRequiredActor } from "../hooks/useRequiredActor.ts";
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
  const [error, setError] = createSignal<string | null>(null);
  const clearError = () => setError(null);
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

  createEffect(() => {
    const name = params.name;
    if (name) {
      setCommunity(null);
      setMembers([]);
      setJoinRequests([]);
      setActiveTab("about");
      setError(null);
      setInviteCode(null);
      setLoading(true);
      loadCommunity();
    }
  });

  const loadCommunity = async () => {
    const name = params.name;
    if (!name) return;
    // Only show loading if no cached data
    if (!community()) setLoading(true);
    try {
      const data = await fetchCommunity(name);
      setCommunity(data);
      const membersData = await fetchCommunityMembers(name);
      setMembers(membersData);
      const canManageNow =
        data.member_role === "owner" || data.member_role === "moderator";
      if (canManageNow) {
        setLoadingRequests(true);
        try {
          const requestsData = await fetchCommunityJoinRequests(name);
          setJoinRequests(requestsData);
        } finally {
          setLoadingRequests(false);
        }
      } else {
        setJoinRequests([]);
      }
    } catch (e) {
      console.error("Failed to load community:", e);
      setError(t("common.error"));
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = async () => {
    const comm = community();
    if (!comm || joining()) return;
    setJoining(true);
    try {
      let inviteId: string | undefined;
      if (comm.join_policy === "invite") {
        const input = window.prompt("Invite code");
        if (!input) {
          setJoining(false);
          return;
        }
        inviteId = input.trim();
      }
      const result = await joinCommunity(comm.name, { inviteId });
      if (result.status === "pending") {
        setCommunity((prev) =>
          prev ? { ...prev, join_status: "pending" } : null,
        );
      } else {
        setCommunity((prev) =>
          prev
            ? {
                ...prev,
                is_member: true,
                join_status: null,
                member_count: prev.member_count + 1,
              }
            : null,
        );
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
    }
  };

  const handleAcceptRequest = async (request: CommunityJoinRequest) => {
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
    } catch (e) {
      console.error("Failed to accept join request:", e);
      setError(t("common.error"));
    } finally {
      setRequestAction((prev) => ({ ...prev, [request.ap_id]: false }));
    }
  };

  const handleRejectRequest = async (request: CommunityJoinRequest) => {
    const comm = community();
    if (!comm) return;
    if (requestAction()[request.ap_id]) return;
    setRequestAction((prev) => ({ ...prev, [request.ap_id]: true }));
    try {
      await rejectCommunityJoinRequest(comm.name, request.ap_id);
      setJoinRequests((prev) => prev.filter((r) => r.ap_id !== request.ap_id));
    } catch (e) {
      console.error("Failed to reject join request:", e);
      setError(t("common.error"));
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

  const handleUpdateMemberRole = async (
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

  // Initialize settings form when community is loaded
  createEffect(() => {
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
  });

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
      setSettingsError("アイコンのアップロードに失敗しました");
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
    } catch {
      setSettingsError("Failed to save settings");
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

      <Show when={!loading() && !community()}>
        <CommunityProfileHeader
          title={t("groups.title")}
          subtitle=""
          onBack={() => navigate(-1)}
        />
        <div class="p-8 text-center text-neutral-500">
          グループが見つかりません
        </div>
      </Show>

      <Show when={!loading() && community()}>
        <CommunityProfileHeader
          title={community()!.display_name || community()!.name}
          subtitle={`${community()!.member_count} メンバー`}
          onBack={() => navigate(-1)}
        />

        <div class="flex-1 overflow-y-auto">
          <CommunityProfileSummary
            community={community()!}
            joining={joining()}
            onJoin={handleJoin}
            onLeave={handleLeave}
            chatPath={`/groups/${community()!.name}/chat`}
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
              概要
              <Show when={activeTab() === "about"}>
                <div class="absolute bottom-0 left-1/2 -translate-x-1/2 w-16 h-1 bg-blue-500 rounded-full" />
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
              メンバー
              <Show when={activeTab() === "members"}>
                <div class="absolute bottom-0 left-1/2 -translate-x-1/2 w-16 h-1 bg-blue-500 rounded-full" />
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
                設定
                <Show when={activeTab() === "settings"}>
                  <div class="absolute bottom-0 left-1/2 -translate-x-1/2 w-16 h-1 bg-blue-500 rounded-full" />
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
    </div>
  );
}

export default CommunityProfilePage;
