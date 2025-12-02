import type { TakosConfig } from "@takos/platform/server";
import { assertActionsInAllowlist } from "@takos/platform/server";

import takosProfileJson from "../../../takos-profile.json";

type TakosProfile = {
  ai?: {
    actions?: unknown;
  };
};

const normalizeActions = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];

  return Array.from(
    new Set(
      value
        .map((item) => (typeof item === "string" ? item : String(item ?? "")))
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
};

const PROFILE_AI_ACTIONS = normalizeActions((takosProfileJson as TakosProfile).ai?.actions);

export function getProfileAiActions(): string[] {
  return PROFILE_AI_ACTIONS;
}

export function assertConfigAiActionsAllowed(config: TakosConfig): void {
  const enabledActions = config.ai?.enabled_actions ?? [];
  assertActionsInAllowlist(enabledActions, PROFILE_AI_ACTIONS);
}
