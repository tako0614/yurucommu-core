import type { Component } from "solid-js";
import type { TranslationKey } from "../../atoms/i18n.ts";
import {
  CreateNavIcon,
  HomeNavIcon,
  ProfileNavIcon,
  ActivityNavIcon,
  SearchNavIcon,
} from "./NavIcons.tsx";

// Single source of truth for the primary navigation surface. Both the desktop
// Sidebar and the mobile BottomNav project from this list so the two stay in
// sync (no divergent hardcoded arrays). An item is either a route link
// (`route`) or an in-app action (`onAction`, e.g. the center Create button that
// opens the post composer).
export interface NavItem {
  id: "home" | "search" | "create" | "activity" | "profile";
  // Icons receive an `active` flag so projections can render a filled vs.
  // outlined glyph.
  icon: Component<{ active: boolean }>;
  labelKey: TranslationKey;
  // Exactly one of `route` / `onAction` is set.
  route?: string;
  // Center affordance: handled by the host (opens the post composer for now).
  onAction?: "create";
  // Surfaces the shared notification unread badge.
  badge?: boolean;
}

// IG-like primary nav: Home, Search, Create (center), Activity, Profile.
export const NAV_ITEMS: NavItem[] = [
  { id: "home", icon: HomeNavIcon, labelKey: "nav.home", route: "/" },
  {
    id: "search",
    icon: SearchNavIcon,
    labelKey: "nav.search",
    route: "/search",
  },
  {
    id: "create",
    icon: CreateNavIcon,
    labelKey: "posts.post",
    onAction: "create",
  },
  {
    id: "activity",
    icon: ActivityNavIcon,
    labelKey: "nav.notifications",
    route: "/notifications",
    badge: true,
  },
  {
    id: "profile",
    icon: ProfileNavIcon,
    labelKey: "nav.profile",
    route: "/profile",
  },
];
