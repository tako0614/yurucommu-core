import { createSignal, For, Show } from "solid-js";
import { A } from "@solidjs/router";
import type { CommunityJoinRequest } from "../../lib/api.ts";
import type {
  CommunityInvite,
  CommunityMember,
} from "../../lib/api/communities.ts";
import { UserAvatar } from "../UserAvatar.tsx";
import type { Translate } from "../../lib/i18n.tsx";

interface CommunityMembersPanelProps {
  members: CommunityMember[];
  joinRequests: CommunityJoinRequest[];
  canManage: boolean;
  isOwner: boolean;
  loadingRequests: boolean;
  requestAction: Record<string, boolean>;
  memberActionError: string | null;
  updatingMemberRole: Record<string, boolean>;
  inviteCode: string | null;
  creatingInvite: boolean;
  invites: CommunityInvite[];
  loadingInvites: boolean;
  revokingInvite: Record<string, boolean>;
  joinPolicy: string | undefined;
  actorApId: string;
  removingMember: Record<string, boolean>;
  onAcceptRequest: (request: CommunityJoinRequest) => void;
  onRejectRequest: (request: CommunityJoinRequest) => void;
  onUpdateMemberRole: (
    member: CommunityMember,
    role: "owner" | "moderator" | "member",
  ) => void;
  onRemoveMember: (member: CommunityMember) => void;
  onCreateInvite: () => void;
  onRevokeInvite: (invite: CommunityInvite) => void;
  t: Translate;
}

export function CommunityMembersPanel(props: CommunityMembersPanelProps) {
  // Brief "Copied" feedback after copying the freshly-created invite code, so the
  // owner doesn't have to hand-select the code text to share it.
  const [inviteCopied, setInviteCopied] = createSignal(false);
  const copyInvite = async () => {
    const code = props.inviteCode;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setInviteCopied(true);
      setTimeout(() => setInviteCopied(false), 1800);
    } catch {
      // Clipboard denied (insecure context / permissions) — leave the code
      // visible for manual selection.
    }
  };
  return (
    <div>
      <Show when={props.canManage}>
        <div class="border-b border-neutral-900">
          <div class="px-4 py-3">
            <div class="text-sm font-semibold text-neutral-400">
              {props.t("members.joinRequests")}
            </div>
          </div>
          <Show
            when={!props.loadingRequests}
            fallback={
              <div class="px-4 pb-4 text-sm text-neutral-500">
                {props.t("common.loading")}
              </div>
            }
          >
            <Show
              when={props.joinRequests.length > 0}
              fallback={
                <div class="px-4 pb-4 text-sm text-neutral-500">
                  {props.t("members.noPendingRequests")}
                </div>
              }
            >
              <For each={props.joinRequests}>
                {(request) => (
                  <div class="flex items-center gap-3 px-4 py-3 border-t border-neutral-900">
                    <UserAvatar
                      avatarUrl={request.icon_url}
                      name={request.name || request.preferred_username}
                      size={40}
                    />
                    <div class="flex-1 min-w-0">
                      <div class="font-semibold text-white truncate">
                        {request.name || request.preferred_username}
                      </div>
                      <div class="text-sm text-neutral-500 truncate">
                        @{request.username}
                      </div>
                    </div>
                    <div class="flex gap-2">
                      <button
                        onClick={() => props.onAcceptRequest(request)}
                        disabled={props.requestAction[request.ap_id]}
                        class="px-3 py-1 text-xs bg-accent text-white rounded-full transition-colors disabled:opacity-50"
                      >
                        {props.t("dm.accept")}
                      </button>
                      <button
                        onClick={() => props.onRejectRequest(request)}
                        disabled={props.requestAction[request.ap_id]}
                        class="px-3 py-1 text-xs bg-neutral-800 text-neutral-200 rounded-full hover:bg-neutral-700 transition-colors disabled:opacity-50"
                      >
                        {props.t("dm.reject")}
                      </button>
                    </div>
                  </div>
                )}
              </For>
            </Show>
          </Show>
        </div>
      </Show>
      <Show when={props.memberActionError}>
        <div class="px-4 py-2 text-sm text-red-400 bg-red-500/10">
          {props.memberActionError}
        </div>
      </Show>
      <Show
        when={props.members.length > 0}
        fallback={
          <div class="p-8 text-center text-neutral-500">
            {props.t("members.noMembers")}
          </div>
        }
      >
        <For each={props.members}>
          {(member) => (
            <A
              href={`/profile/${encodeURIComponent(member.ap_id)}`}
              class="flex items-center gap-3 px-4 py-3 hover:bg-neutral-900/30 transition-colors"
            >
              <UserAvatar
                avatarUrl={member.icon_url}
                name={member.name || member.preferred_username}
                size={48}
              />
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <span class="font-bold text-white truncate">
                    {member.name || member.preferred_username}
                  </span>
                  <Show when={member.role === "owner"}>
                    <span class="px-1.5 py-0.5 text-xs bg-yellow-500/20 text-yellow-400 rounded">
                      {props.t("members.owner")}
                    </span>
                  </Show>
                  <Show when={member.role === "moderator"}>
                    <span class="px-1.5 py-0.5 text-xs bg-accent-soft text-accent rounded">
                      {props.t("members.moderator")}
                    </span>
                  </Show>
                </div>
                <div class="text-neutral-500 truncate">@{member.username}</div>
              </div>
              <Show when={props.isOwner && member.ap_id !== props.actorApId}>
                <select
                  value={member.role}
                  aria-label={props
                    .t("members.changeRole")
                    .replace(
                      "{name}",
                      member.name || member.preferred_username,
                    )}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onChange={(e) =>
                    props.onUpdateMemberRole(
                      member,
                      e.currentTarget.value as "owner" | "moderator" | "member",
                    )
                  }
                  disabled={props.updatingMemberRole[member.ap_id]}
                  class="ml-auto bg-neutral-900 border border-neutral-700 text-xs text-white rounded-lg px-2 py-1"
                >
                  <option value="member">{props.t("members.member")}</option>
                  <option value="moderator">
                    {props.t("members.moderator")}
                  </option>
                  <option value="owner">{props.t("members.owner")}</option>
                </select>
              </Show>
              {/* Remove (kick): a manager may remove non-owners; only an owner
                  may remove another owner — mirrors the backend requireManager +
                  owner-vs-owner guard. Never shown for self (use leave). */}
              <Show
                when={
                  props.canManage &&
                  member.ap_id !== props.actorApId &&
                  (member.role !== "owner" || props.isOwner)
                }
              >
                <button
                  type="button"
                  aria-label={props
                    .t("members.removeConfirm")
                    .replace(
                      "{name}",
                      member.name || member.preferred_username,
                    )}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    props.onRemoveMember(member);
                  }}
                  disabled={props.removingMember[member.ap_id]}
                  class="text-xs text-rose-400 hover:text-rose-300 disabled:opacity-50 shrink-0"
                >
                  {props.t("members.remove")}
                </button>
              </Show>
            </A>
          )}
        </For>
      </Show>
      <Show when={props.canManage && props.joinPolicy === "invite"}>
        <div class="mt-4 p-3 bg-neutral-900/50 rounded-lg">
          <div class="text-sm font-semibold text-neutral-300 mb-2">
            {props.t("members.inviteCode")}
          </div>
          <div class="flex items-center gap-2 flex-wrap">
            <button
              onClick={props.onCreateInvite}
              disabled={props.creatingInvite}
              class="px-3 py-1 text-xs bg-accent text-white rounded-full transition-colors disabled:opacity-50"
            >
              {props.creatingInvite
                ? props.t("members.creatingInvite")
                : props.t("members.createInvite")}
            </button>
            <Show when={props.inviteCode}>
              <span class="px-2 py-1 text-xs bg-neutral-800 text-neutral-200 rounded font-mono">
                {props.inviteCode}
              </span>
              <button
                onClick={copyInvite}
                aria-label={props.t("members.copyInvite")}
                class="px-3 py-1 text-xs bg-neutral-800 text-neutral-200 rounded-full hover:bg-neutral-700 transition-colors"
              >
                {inviteCopied()
                  ? props.t("members.inviteCopied")
                  : props.t("members.copyInvite")}
              </button>
            </Show>
          </div>

          {/* Outstanding invites with their state + a revoke control, so a
              leaked/over-shared code can actually be invalidated from the app. */}
          <Show when={!props.loadingInvites} fallback={null}>
            <Show
              when={props.invites.length > 0}
              fallback={
                <div class="mt-3 text-xs text-neutral-500">
                  {props.t("members.noInvites")}
                </div>
              }
            >
              <div class="mt-3 space-y-2">
                <For each={props.invites}>
                  {(invite) => {
                    const used = () => invite.used_at !== null;
                    const expired = () =>
                      !used() &&
                      invite.expires_at !== null &&
                      invite.expires_at <= new Date().toISOString();
                    return (
                      <div class="flex items-center gap-2 text-xs">
                        <span class="font-mono text-neutral-300 truncate">
                          {invite.id}
                        </span>
                        <span
                          class="px-1.5 py-0.5 rounded"
                          classList={{
                            "bg-neutral-800 text-neutral-400":
                              used() || expired(),
                            "bg-green-500/15 text-green-400":
                              !used() && !expired(),
                          }}
                        >
                          {used()
                            ? props.t("members.inviteUsed")
                            : expired()
                              ? props.t("members.inviteExpired")
                              : props.t("members.inviteActive")}
                        </span>
                        <Show when={!used()}>
                          <button
                            type="button"
                            onClick={() => props.onRevokeInvite(invite)}
                            disabled={props.revokingInvite[invite.id]}
                            class="ml-auto text-rose-400 hover:text-rose-300 disabled:opacity-50 shrink-0"
                          >
                            {props.t("members.revokeInvite")}
                          </button>
                        </Show>
                      </div>
                    );
                  }}
                </For>
              </div>
            </Show>
          </Show>
        </div>
      </Show>
    </div>
  );
}
