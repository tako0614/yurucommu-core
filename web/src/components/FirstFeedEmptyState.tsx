import { For } from "solid-js";
import type { JSX } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { useI18n } from "../lib/i18n.tsx";

interface FirstFeedEmptyStateProps {
  /** Triggers the Story composer (wired by the timeline). */
  onCreateStory: () => void;
  /** Opens the community composer (CreateScopeModal). */
  onCreateCommunity: () => void;
  /** Routes to the discovery surface to find/join existing communities. */
  onDiscoverCommunities: () => void;
  /**
   * The active community scope, or null/undefined when the inhabited scope is
   * personal. When a community is active the empty state swaps its personal
   * "grow your reach" CTAs for community-appropriate ones (post / invite).
   */
  communityScope?: { name: string } | null;
  /** Opens the global post composer (aimed at the active scope). */
  onCreatePost?: () => void;
}

const SearchIcon = () => (
  <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width={2}
      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
    />
  </svg>
);

const CommunitiesIcon = () => (
  <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width={2}
      d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
    />
  </svg>
);

const InviteIcon = () => (
  <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width={2}
      d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
    />
  </svg>
);

const PostIcon = () => (
  <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width={2}
      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
    />
  </svg>
);

const StoryIcon = () => (
  <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width={2}
      d="M12 6v6m0 0v6m0-6h6m-6 0H6"
    />
  </svg>
);

/**
 * Action-oriented empty state for the first-run timeline. Instead of a passive
 * "no posts" wall, it nudges the new inhabitant toward the actions that grow
 * their reach: finding people, exploring communities, and posting a Story.
 */
type EmptyStateAction = {
  icon: JSX.Element;
  label: string;
  onClick: () => void;
  primary?: boolean;
};

export function FirstFeedEmptyState(props: FirstFeedEmptyStateProps) {
  const { t } = useI18n();
  const navigate = useNavigate();

  // Personal-scope CTAs: grow the owner's own reach (find people / communities /
  // post a Story). These make no sense inside a community, where the empty feed
  // means "nobody has posted here yet" — see the community branch below.
  const personalActions = (): EmptyStateAction[] => [
    {
      icon: <SearchIcon />,
      label: t("firstFeed.findPeople"),
      onClick: () => navigate("/search"),
      primary: true,
    },
    {
      icon: <CommunitiesIcon />,
      label: t("firstFeed.createCommunity"),
      onClick: () => props.onCreateCommunity(),
    },
    {
      icon: <CommunitiesIcon />,
      label: t("firstFeed.discoverCommunities"),
      onClick: () => props.onDiscoverCommunities(),
    },
    {
      icon: <StoryIcon />,
      label: t("firstFeed.firstStory"),
      onClick: () => props.onCreateStory(),
    },
  ];

  // Community-scope CTAs: seed the room you are standing in. Post the first
  // message, invite members (the community profile / members surface), or read
  // about the community.
  const communityActions = (name: string): EmptyStateAction[] => [
    {
      icon: <PostIcon />,
      label: t("scope.communityFirstPost"),
      onClick: () =>
        props.onCreatePost ? props.onCreatePost() : props.onCreateStory(),
      primary: true,
    },
    {
      icon: <InviteIcon />,
      label: t("scope.communityInvite"),
      onClick: () => navigate(`/groups/${encodeURIComponent(name)}`),
    },
    {
      icon: <CommunitiesIcon />,
      label: t("scope.communityAbout"),
      onClick: () => navigate(`/groups/${encodeURIComponent(name)}`),
    },
  ];

  const community = () => props.communityScope ?? null;

  const actions = (): EmptyStateAction[] => {
    const c = community();
    return c ? communityActions(c.name) : personalActions();
  };

  const title = () =>
    community() ? t("scope.communityEmptyTitle") : t("firstFeed.title");
  const description = () =>
    community() ? t("scope.communityEmptyBody") : t("firstFeed.description");

  return (
    <div class="flex min-h-[50vh] flex-col items-center justify-center p-8 text-center">
      <h2 class="text-xl font-bold text-neutral-100">{title()}</h2>
      <p class="mt-2 max-w-xs text-sm text-neutral-400">{description()}</p>
      <div class="mt-6 w-full max-w-xs space-y-3">
        <For each={actions()}>
          {(action) => (
            <button
              type="button"
              onClick={action.onClick}
              class={
                action.primary
                  ? "flex w-full items-center justify-center gap-3 rounded-full bg-accent px-5 py-3 text-sm font-medium text-white transition-colors"
                  : "flex w-full items-center justify-center gap-3 rounded-full border border-neutral-700 px-5 py-3 text-sm font-medium text-neutral-200 transition-colors hover:bg-neutral-800"
              }
            >
              {action.icon}
              {action.label}
            </button>
          )}
        </For>
      </div>
    </div>
  );
}

export default FirstFeedEmptyState;
