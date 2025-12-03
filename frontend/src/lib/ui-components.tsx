/**
 * Custom UI Components Registration
 *
 * Registers application-specific components for UiNode rendering
 * (PLAN.md 7: UI ランタイム完全移行)
 */

import type { Component, JSX } from "solid-js";
import { For, Show, createSignal, createResource, Suspense } from "solid-js";
import { registerUiComponent, type UiRuntimeContext } from "./ui-runtime";

// Import existing components
import PostCard from "../components/PostCard";
import AllStoriesBar from "../components/AllStoriesBar";
import Avatar from "../components/Avatar";
import { api } from "./api";

/**
 * PostFeed - Displays a list of posts
 */
const PostFeed: Component<{
  source?: string;
  communityId?: string;
  emptyText?: string;
  context?: UiRuntimeContext;
}> = (props) => {
  const [posts] = createResource(
    () => ({
      source: props.source,
      communityId: props.communityId || props.context?.routeParams?.id,
    }),
    async ({ source, communityId }) => {
      try {
        if (source === "community" && communityId) {
          return await api(`/communities/${communityId}/posts`);
        }
        if (source === "user" && props.context?.routeParams?.userId) {
          return await api(`/users/${props.context.routeParams.userId}/posts`);
        }
        // Default: home timeline
        return await api("/posts");
      } catch (err) {
        console.error("[PostFeed] Failed to load posts:", err);
        return [];
      }
    }
  );

  const handleUpdated = (updatedPost: any) => {
    // PostCard handles its own state updates
    console.log("[PostFeed] Post updated:", updatedPost.id);
  };

  const handleDeleted = (postId: string) => {
    // PostCard handles its own state updates
    console.log("[PostFeed] Post deleted:", postId);
  };

  return (
    <Suspense fallback={<div class="text-center py-8 text-muted">Loading...</div>}>
      <Show
        when={posts() && posts()!.length > 0}
        fallback={
          <div class="text-center py-8 text-muted">
            {props.emptyText || "No posts yet"}
          </div>
        }
      >
        <div class="grid gap-2">
          <For each={posts()}>
            {(post) => (
              <PostCard
                post={post}
                onUpdated={handleUpdated}
                onDeleted={handleDeleted}
              />
            )}
          </For>
        </div>
      </Show>
    </Suspense>
  );
};

/**
 * StoriesBar - Displays story avatars
 */
const StoriesBar: Component<{
  communityId?: string;
  context?: UiRuntimeContext;
}> = (props) => {
  const communityId = () =>
    props.communityId || props.context?.routeParams?.id;

  return <AllStoriesBar preferredCommunityId={communityId()} />;
};

/**
 * UserAvatar - User avatar display
 */
const UserAvatar: Component<{
  src?: string;
  size?: "sm" | "md" | "lg";
  alt?: string;
}> = (props) => {
  const sizeClasses = {
    sm: "w-8 h-8",
    md: "w-12 h-12",
    lg: "w-16 h-16",
  };
  const sizeClass = sizeClasses[props.size || "md"];

  return (
    <Avatar
      src={props.src || ""}
      alt={props.alt || "User"}
      class={`${sizeClass} rounded-full bg-gray-200 dark:bg-neutral-700`}
    />
  );
};

/**
 * ThreadList - DM thread list
 */
const ThreadList: Component<{
  emptyText?: string;
  context?: UiRuntimeContext;
}> = (props) => {
  const [threads] = createResource(async () => {
    try {
      return await api("/dm/threads");
    } catch (err) {
      console.error("[ThreadList] Failed to load threads:", err);
      return [];
    }
  });

  return (
    <Suspense fallback={<div class="text-center py-8 text-muted">Loading...</div>}>
      <Show
        when={threads() && threads()!.length > 0}
        fallback={
          <div class="text-center py-8 text-muted">
            {props.emptyText || "No messages yet"}
          </div>
        }
      >
        <div class="divide-y divide-gray-200 dark:divide-neutral-700">
          <For each={threads()}>
            {(thread: any) => (
              <a
                href={`/dm/${thread.id}`}
                class="block p-4 hover:bg-gray-50 dark:hover:bg-neutral-800"
              >
                <div class="flex items-center gap-3">
                  <UserAvatar src={thread.participant?.avatar_url} size="md" />
                  <div class="flex-1 min-w-0">
                    <div class="font-semibold text-gray-900 dark:text-white truncate">
                      {thread.participant?.display_name || thread.participant?.handle || "Unknown"}
                    </div>
                    <div class="text-sm text-gray-500 truncate">
                      {thread.last_message?.text || ""}
                    </div>
                  </div>
                </div>
              </a>
            )}
          </For>
        </div>
      </Show>
    </Suspense>
  );
};

/**
 * CommunityList - Community list display
 */
const CommunityList: Component<{
  showJoined?: boolean;
  emptyText?: string;
  context?: UiRuntimeContext;
}> = (props) => {
  const endpoint = () => (props.showJoined ? "/me/communities" : "/communities");

  const [communities] = createResource(endpoint, async (path) => {
    try {
      return await api(path);
    } catch (err) {
      console.error("[CommunityList] Failed to load communities:", err);
      return [];
    }
  });

  return (
    <Suspense fallback={<div class="text-center py-8 text-muted">Loading...</div>}>
      <Show
        when={communities() && communities()!.length > 0}
        fallback={
          <div class="text-center py-8 text-muted">
            {props.emptyText || "No communities found"}
          </div>
        }
      >
        <div class="grid gap-4">
          <For each={communities()}>
            {(community: any) => (
              <a
                href={`/communities/${community.id}`}
                class="block p-4 bg-white dark:bg-neutral-800 rounded-lg border border-gray-200 dark:border-neutral-700 hover:border-blue-500"
              >
                <div class="flex items-center gap-3">
                  <Show when={community.icon_url}>
                    <img
                      src={community.icon_url}
                      alt=""
                      class="w-12 h-12 rounded-lg object-cover"
                    />
                  </Show>
                  <div class="flex-1 min-w-0">
                    <div class="font-semibold text-gray-900 dark:text-white">
                      {community.name}
                    </div>
                    <Show when={community.description}>
                      <div class="text-sm text-gray-500 line-clamp-2">
                        {community.description}
                      </div>
                    </Show>
                  </div>
                </div>
              </a>
            )}
          </For>
        </div>
      </Show>
    </Suspense>
  );
};

/**
 * NavLink - Navigation link with active state
 */
const NavLink: Component<{
  href?: string;
  text?: string;
  icon?: string;
  children?: JSX.Element;
}> = (props) => {
  const isActive = () => {
    if (typeof window === "undefined") return false;
    return window.location.pathname === props.href;
  };

  return (
    <a
      href={props.href}
      class={`flex items-center gap-2 px-3 py-2 rounded-lg ${
        isActive()
          ? "bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400"
          : "hover:bg-gray-100 dark:hover:bg-neutral-800"
      }`}
    >
      <Show when={props.icon}>
        <span>{props.icon}</span>
      </Show>
      {props.children || props.text}
    </a>
  );
};

/**
 * PageHeader - Page header with title and actions
 */
const PageHeader: Component<{
  title?: string;
  backHref?: string;
  children?: JSX.Element;
}> = (props) => {
  return (
    <div class="flex items-center gap-4 mb-6">
      <Show when={props.backHref}>
        <a
          href={props.backHref}
          class="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-neutral-800"
        >
          ←
        </a>
      </Show>
      <h1 class="text-xl font-bold text-gray-900 dark:text-white flex-1">
        {props.title}
      </h1>
      {props.children}
    </div>
  );
};

/**
 * Register all custom components
 */
export function registerCustomComponents() {
  registerUiComponent("PostFeed", PostFeed);
  registerUiComponent("StoriesBar", StoriesBar);
  registerUiComponent("UserAvatar", UserAvatar);
  registerUiComponent("ThreadList", ThreadList);
  registerUiComponent("CommunityList", CommunityList);
  registerUiComponent("NavLink", NavLink);
  registerUiComponent("PageHeader", PageHeader);

  console.log("[UiComponents] Custom components registered");
}
