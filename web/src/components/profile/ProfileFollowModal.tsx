import { For, Show } from "solid-js";
import { A } from "@solidjs/router";
import type { Actor } from "../../types/index.ts";
import { UserAvatar } from "../UserAvatar.tsx";
import { CloseIcon } from "./ProfileIcons.tsx";
import type { Translate } from "../../lib/i18n.tsx";

type FollowModalType = "followers" | "following" | null;

interface ProfileFollowModalProps {
  type: FollowModalType;
  actors: Actor[];
  loading: boolean;
  onClose: () => void;
  t: Translate;
}

export function ProfileFollowModal(props: ProfileFollowModalProps) {
  return (
    <Show when={props.type}>
      <div class="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
        <div class="bg-neutral-900 rounded-2xl w-full max-w-md max-h-[80vh] flex flex-col">
          <div class="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
            <div class="flex items-center gap-4">
              <button
                onClick={props.onClose}
                aria-label="Close"
                class="p-1 hover:bg-neutral-800 rounded-full transition-colors"
              >
                <CloseIcon />
              </button>
              <h2 class="text-lg font-bold">
                {props.type === "followers"
                  ? props.t("profile.followers")
                  : props.t("profile.following")}
              </h2>
            </div>
          </div>
          <div class="flex-1 overflow-y-auto">
            <Show
              when={!props.loading}
              fallback={
                <div class="p-8 text-center text-neutral-500">
                  {props.t("common.loading")}
                </div>
              }
            >
              <Show
                when={props.actors.length > 0}
                fallback={
                  <div class="p-8 text-center text-neutral-500">
                    {props.type === "followers"
                      ? "No followers yet"
                      : "Not following anyone"}
                  </div>
                }
              >
                <For each={props.actors}>
                  {(actor) => (
                    <A
                      href={`/profile/${encodeURIComponent(actor.ap_id)}`}
                      onClick={props.onClose}
                      class="flex items-center gap-3 px-4 py-3 hover:bg-neutral-800 transition-colors"
                    >
                      <UserAvatar
                        avatarUrl={actor.icon_url}
                        name={actor.name || actor.preferred_username}
                        size={48}
                      />
                      <div class="flex-1 min-w-0">
                        <div class="font-bold text-white truncate">
                          {actor.name || actor.preferred_username}
                        </div>
                        <div class="text-neutral-500 truncate">
                          @{actor.username}
                        </div>
                      </div>
                    </A>
                  )}
                </For>
              </Show>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
}
