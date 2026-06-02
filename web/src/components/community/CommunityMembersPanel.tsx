import { For, Show } from "solid-js";
import { A } from "@solidjs/router";
import type { CommunityJoinRequest } from "../../lib/api.ts";
import type { CommunityMember } from "../../lib/api/communities.ts";
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
  joinPolicy: string | undefined;
  actorApId: string;
  onAcceptRequest: (request: CommunityJoinRequest) => void;
  onRejectRequest: (request: CommunityJoinRequest) => void;
  onUpdateMemberRole: (
    member: CommunityMember,
    role: "owner" | "moderator" | "member",
  ) => void;
  onCreateInvite: () => void;
  t: Translate;
}

export function CommunityMembersPanel(props: CommunityMembersPanelProps) {
  return (
    <div>
      <Show when={props.canManage}>
        <div class="border-b border-neutral-900">
          <div class="px-4 py-3">
            <div class="text-sm font-semibold text-neutral-400">
              Join Requests
            </div>
          </div>
          <Show
            when={!props.loadingRequests}
            fallback={
              <div class="px-4 pb-4 text-sm text-neutral-500">Loading...</div>
            }
          >
            <Show
              when={props.joinRequests.length > 0}
              fallback={
                <div class="px-4 pb-4 text-sm text-neutral-500">
                  No pending requests
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
                        class="px-3 py-1 text-xs bg-blue-500 text-white rounded-full hover:bg-blue-600 transition-colors disabled:opacity-50"
                      >
                        Accept
                      </button>
                      <button
                        onClick={() => props.onRejectRequest(request)}
                        disabled={props.requestAction[request.ap_id]}
                        class="px-3 py-1 text-xs bg-neutral-800 text-neutral-200 rounded-full hover:bg-neutral-700 transition-colors disabled:opacity-50"
                      >
                        Reject
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
          <div class="p-8 text-center text-neutral-500">メンバーがいません</div>
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
                      オーナー
                    </span>
                  </Show>
                  <Show when={member.role === "moderator"}>
                    <span class="px-1.5 py-0.5 text-xs bg-blue-500/20 text-blue-400 rounded">
                      モデレーター
                    </span>
                  </Show>
                </div>
                <div class="text-neutral-500 truncate">@{member.username}</div>
              </div>
              <Show when={props.isOwner && member.ap_id !== props.actorApId}>
                <select
                  value={member.role}
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
            </A>
          )}
        </For>
      </Show>
      <Show when={props.canManage && props.joinPolicy === "invite"}>
        <div class="mt-4 p-3 bg-neutral-900/50 rounded-lg">
          <div class="text-sm font-semibold text-neutral-300 mb-2">
            Invite Code
          </div>
          <div class="flex items-center gap-2 flex-wrap">
            <button
              onClick={props.onCreateInvite}
              disabled={props.creatingInvite}
              class="px-3 py-1 text-xs bg-blue-500 text-white rounded-full hover:bg-blue-600 transition-colors disabled:opacity-50"
            >
              {props.creatingInvite ? "Creating..." : "Create"}
            </button>
            <Show when={props.inviteCode}>
              <span class="px-2 py-1 text-xs bg-neutral-800 text-neutral-200 rounded">
                {props.inviteCode}
              </span>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
}
