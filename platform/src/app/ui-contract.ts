import type { AppManifest, AppManifestValidationIssue, AppViewInsertDefinition } from "./types";
import { TAKOS_UI_CONTRACT_VERSION } from "../config/versions.js";

export type UiContractScreen = {
  id: string;
  label?: string;
  routes?: string[];
  steps_from_home?: number;
};

export type UiContractAction = {
  id: string;
  available_on?: string[];
  max_steps_from_home?: number;
};

export type UiContract = {
  schema_version?: string;
  screens?: UiContractScreen[];
  actions?: UiContractAction[];
};

type ParsedContract = {
  contract?: UiContract | null;
  issues: AppManifestValidationIssue[];
};

const UI_CONTRACT_FILE = "schemas/ui-contract.json";
const SCREEN_ID_FORMAT = /^screen\.[a-z_]+$/;
const ACTION_ID_FORMAT = /^action\.[a-z_]+$/;

export function parseUiContractJson(raw: string, source?: string): ParsedContract {
  const issues: AppManifestValidationIssue[] = [];
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      issues.push({
        severity: "warning",
        message: "UI contract must be a JSON object",
        file: source ?? UI_CONTRACT_FILE,
      });
      return { issues };
    }
    return { contract: parsed as UiContract, issues };
  } catch (error) {
    issues.push({
      severity: "warning",
      message: `Failed to parse UI contract JSON: ${(error as Error).message}`,
      file: source ?? UI_CONTRACT_FILE,
    });
    return { issues };
  }
}

type ActionIndex = Map<string, Set<string>>;

const collectActionsFromNode = (node: any, bucket: Set<string>): void => {
  if (!node || typeof node !== "object") return;
  const action = node?.props?.action;
  if (typeof action === "string" && action.trim()) {
    bucket.add(action.trim());
  }
  const children = Array.isArray(node?.children) ? node.children : [];
  for (const child of children) {
    collectActionsFromNode(child, bucket);
  }
};

const collectActionsByScreen = (manifest: AppManifest): ActionIndex => {
  const actionsByScreen: ActionIndex = new Map();
  const screens = Array.isArray(manifest.views?.screens) ? manifest.views.screens : [];
  for (const screen of screens) {
    const bucket = new Set<string>();
    collectActionsFromNode((screen as any)?.layout, bucket);
    actionsByScreen.set(screen.id, bucket);
  }

  const inserts = Array.isArray(manifest.views?.insert) ? manifest.views.insert : [];
  for (const insert of inserts) {
    const target = insert?.screen;
    if (typeof target !== "string" || !target.trim()) continue;
    const bucket = actionsByScreen.get(target) ?? new Set<string>();
    collectActionsFromNode((insert as AppViewInsertDefinition).node, bucket);
    actionsByScreen.set(target, bucket);
  }

  return actionsByScreen;
};

const toWarning = (message: string, file?: string, path?: string): AppManifestValidationIssue => ({
  severity: "warning",
  message,
  ...(file ? { file } : {}),
  ...(path ? { path } : {}),
});

export function validateUiContractAgainstManifest(
  manifest: AppManifest | null | undefined,
  contract: UiContract | null | undefined,
  source?: string,
): AppManifestValidationIssue[] {
  const issues: AppManifestValidationIssue[] = [];
  const file = source ?? UI_CONTRACT_FILE;

  if (!manifest) {
    issues.push(toWarning("App manifest missing; skipping UI contract validation", file));
    return issues;
  }

  if (!contract) {
    issues.push(toWarning("UI contract not found; skipping reachability checks", file));
    return issues;
  }

  if (contract.schema_version && contract.schema_version !== TAKOS_UI_CONTRACT_VERSION) {
    issues.push(
      toWarning(
        `UI contract schema_version should be "${TAKOS_UI_CONTRACT_VERSION}" (got ${contract.schema_version})`,
        file,
        "schema_version",
      ),
    );
  }

  const contractScreens = Array.isArray(contract.screens) ? contract.screens : [];
  const contractActions = Array.isArray(contract.actions) ? contract.actions : [];

  const screenSteps = new Map<string, number>();
  const contractScreenIds = new Set<string>();
  const duplicateScreenIds = new Set<string>();

  contractScreens.forEach((screen, index) => {
    const id = typeof screen?.id === "string" ? screen.id.trim() : "";
    if (!id) {
      issues.push(toWarning("Screen id must be a non-empty string", file, `screens[${index}].id`));
      return;
    }
    if (!SCREEN_ID_FORMAT.test(id)) {
      issues.push(toWarning(`Screen id "${id}" must match ${String(SCREEN_ID_FORMAT)}`, file, `screens[${index}].id`));
    }
    if (contractScreenIds.has(id)) {
      duplicateScreenIds.add(id);
    }
    contractScreenIds.add(id);

    if (screen.steps_from_home === undefined) {
      issues.push(
        toWarning(`Screen ${id} is missing steps_from_home`, file, `screens[${index}].steps_from_home`),
      );
      return;
    }
    if (typeof screen.steps_from_home !== "number" || screen.steps_from_home < 0) {
      issues.push(
        toWarning(
          `Screen ${id} steps_from_home must be a non-negative number`,
          file,
          `screens[${index}].steps_from_home`,
        ),
      );
      return;
    }
    if (!Array.isArray(screen.routes) || screen.routes.length === 0) {
      issues.push(
        toWarning(`Screen ${id} must declare at least one route`, file, `screens[${index}].routes`),
      );
    }
    screenSteps.set(id, screen.steps_from_home);
  });
  for (const id of duplicateScreenIds) {
    issues.push(toWarning(`Duplicate screen id "${id}" in UI contract`, file, "screens"));
  }

  const requiredScreens = [
    "screen.home",
    "screen.community",
    "screen.channel",
    "screen.dm_list",
    "screen.dm_thread",
    "screen.story_viewer",
    "screen.profile",
    "screen.settings",
    "screen.notifications",
    "screen.storage",
    "screen.storage_folder",
  ];
  for (const id of requiredScreens) {
    if (!contractScreenIds.has(id)) {
      issues.push(toWarning(`Required screen ${id} missing from UI contract`, file, "screens"));
    }
  }

  if (screenSteps.has("screen.home") && screenSteps.get("screen.home") !== 0) {
    issues.push(toWarning("screen.home must declare steps_from_home = 0", file, "screens"));
  }

  const profileSteps = screenSteps.get("screen.profile");
  if (profileSteps !== undefined && profileSteps > 2) {
    issues.push(toWarning("screen.profile must be reachable within 2 steps from screen.home", file, "screens"));
  }

  const settingsSteps = screenSteps.get("screen.settings");
  if (settingsSteps !== undefined && settingsSteps > 2) {
    issues.push(toWarning("screen.settings must be reachable within 2 steps from screen.home", file, "screens"));
  }

  const manifestScreens = Array.isArray(manifest.views?.screens) ? manifest.views.screens : [];
  const manifestScreenIds = new Set(manifestScreens.map((screen) => screen.id).filter(Boolean));
  for (const id of contractScreenIds) {
    if (!manifestScreenIds.has(id)) {
      issues.push(toWarning(`screen ${id} defined in UI contract is missing from manifest views`, file));
    }
  }

  const actionsByScreen = collectActionsByScreen(manifest);
  const actionIds = new Set<string>();
  const duplicateActionIds = new Set<string>();

  contractActions.forEach((action, index) => {
    const id = typeof action?.id === "string" ? action.id.trim() : "";
    if (!id) {
      issues.push(toWarning("Action id must be a non-empty string", file, `actions[${index}].id`));
      return;
    }
    if (!ACTION_ID_FORMAT.test(id)) {
      issues.push(toWarning(`Action id "${id}" must match ${String(ACTION_ID_FORMAT)}`, file, `actions[${index}].id`));
    }
    if (actionIds.has(id)) {
      duplicateActionIds.add(id);
    }
    actionIds.add(id);

    const availableOn = Array.isArray(action.available_on)
      ? action.available_on.filter(
          (value): value is string => typeof value === "string" && value.trim().length > 0,
        )
      : [];
    if (availableOn.length === 0) {
      issues.push(
        toWarning(`Action ${id} must declare available_on screens`, file, `actions[${index}].available_on`),
      );
    }

    const maxSteps = typeof action.max_steps_from_home === "number" ? action.max_steps_from_home : null;
    const distances = availableOn
      .map((screenId) => screenSteps.get(screenId))
      .filter((value): value is number => typeof value === "number");
    const minDistance = distances.length > 0 ? Math.min(...distances) : Infinity;

    if (distances.length === 0) {
      issues.push(
        toWarning(
          `Action ${id} references screens that have no steps_from_home defined`,
          file,
          `actions[${index}].available_on`,
        ),
      );
    }

    if (maxSteps !== null && minDistance !== Infinity && minDistance > maxSteps) {
      issues.push(
        toWarning(
          `Action ${id} requires at least ${minDistance} steps from screen.home but max_steps_from_home is ${maxSteps}`,
          file,
          `actions[${index}].max_steps_from_home`,
        ),
      );
    }

    const screensWithAction = availableOn.filter((screenId) => actionsByScreen.get(screenId)?.has(id));
    if (screensWithAction.length === 0) {
      issues.push(
        toWarning(
          `Action ${id} is not present on any available_on screens in manifest views`,
          file,
          `actions[${index}]`,
        ),
      );
    }

    if (id === "action.open_composer") {
      if (!availableOn.includes("screen.home")) {
        issues.push(toWarning("action.open_composer must be available on screen.home", file, `actions[${index}].available_on`));
      }
      if (minDistance !== Infinity && minDistance > 1) {
        issues.push(
          toWarning(
            "action.open_composer must be reachable within 1 step from screen.home",
            file,
            `actions[${index}].max_steps_from_home`,
          ),
        );
      }
    }

    if (id === "action.open_notifications") {
      if (!availableOn.includes("screen.home")) {
        issues.push(
          toWarning("action.open_notifications must be available on screen.home", file, `actions[${index}].available_on`),
        );
      }
      if (minDistance !== Infinity && minDistance > 1) {
        issues.push(
          toWarning(
            "action.open_notifications must be reachable within 1 step from screen.home",
            file,
            `actions[${index}].max_steps_from_home`,
          ),
        );
      }
    }

    if (id === "action.open_dm_thread") {
      const allowedScreens = availableOn.filter(
        (screenId) => screenId === "screen.dm_list" || screenId === "screen.dm_thread",
      );
      if (allowedScreens.length === 0) {
        issues.push(
          toWarning(
            "action.open_dm_thread must be available on screen.dm_list or screen.dm_thread",
            file,
            `actions[${index}].available_on`,
          ),
        );
      }
      if (minDistance !== Infinity && minDistance > 2) {
        issues.push(
          toWarning(
            "action.open_dm_thread must be reachable within 2 steps from screen.home",
            file,
            `actions[${index}].max_steps_from_home`,
          ),
        );
      }
    }

    if (id === "action.send_dm") {
      const allowedScreens = availableOn.filter((screenId) => screenId === "screen.dm_thread");
      if (allowedScreens.length === 0) {
        issues.push(
          toWarning("action.send_dm must be available on screen.dm_thread", file, `actions[${index}].available_on`),
        );
      }
      if (minDistance !== Infinity && minDistance > 2) {
        issues.push(
          toWarning(
            "action.send_dm must be reachable within 2 steps from screen.home",
            file,
            `actions[${index}].max_steps_from_home`,
          ),
        );
      }
    }

    if (id === "action.edit_profile") {
      if (minDistance !== Infinity && minDistance > 2) {
        issues.push(
          toWarning(
            "action.edit_profile must be reachable within 2 steps from screen.home",
            file,
            `actions[${index}].max_steps_from_home`,
          ),
        );
      }
    }
  });
  for (const id of duplicateActionIds) {
    issues.push(toWarning(`Duplicate action id "${id}" in UI contract`, file, "actions"));
  }

  const requiredActions = [
    "action.open_composer",
    "action.send_post",
    "action.open_notifications",
    "action.open_dm_thread",
    "action.send_dm",
    "action.reply",
    "action.react",
    "action.view_story",
    "action.edit_profile",
    "action.upload_file",
    "action.delete_file",
    "action.create_folder",
    "action.move_file",
  ];
  for (const id of requiredActions) {
    if (!actionIds.has(id)) {
      issues.push(toWarning(`Required action ${id} missing from UI contract`, file, "actions"));
    }
  }

  return issues;
}

export function mergeContractIssues(
  manifestIssues: AppManifestValidationIssue[],
  contractIssues: AppManifestValidationIssue[],
): AppManifestValidationIssue[] {
  return [...manifestIssues, ...contractIssues];
}
