import type { PublicAccountBindings as Bindings } from "@takos/platform/server";

export type CronTaskDefinition = {
  id: string;
  title: string;
  description: string;
  schedule: string;
  required: boolean;
  endpoint?: {
    method: "POST" | "GET";
    path: string;
    requiresSecret?: boolean;
  };
};

const normalizeCron = (expr: string): string =>
  expr
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

const parseCronList = (raw: string | undefined): string[] => {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];

  // Support JSON array input
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => normalizeCron(String(item || ""))).filter(Boolean);
      }
    } catch {
      // fall through to plain parsing
    }
  }

  return trimmed
    .split(/[\n,]+/)
    .map((expr) => normalizeCron(expr))
    .filter(Boolean);
};

export const CRON_TASKS: CronTaskDefinition[] = [
  {
    id: "activitypub-workers",
    title: "ActivityPub delivery + inbox",
    description: "Process delivery and inbox queues (outbox -> delivery queue, inbox processing).",
    schedule: "*/5 * * * *",
    required: true,
  },
  {
    id: "scheduled-posts",
    title: "Scheduled posts (post-plans)",
    description: "Publish due post plans and update their status.",
    schedule: "*/5 * * * *",
    required: true,
    endpoint: {
      method: "POST",
      path: "/internal/tasks/process-post-plans",
      requiresSecret: true,
    },
  },
  {
    id: "story-expiration",
    title: "Story expiration cleanup",
    description: "Delete expired stories and fan out delete activities.",
    schedule: "*/5 * * * *",
    required: true,
    endpoint: {
      method: "POST",
      path: "/internal/tasks/cleanup-stories",
      requiresSecret: true,
    },
  },
  {
    id: "data-exports",
    title: "Data export processor",
    description: "Process pending data export requests.",
    schedule: "*/5 * * * *",
    required: true,
    endpoint: {
      method: "POST",
      path: "/internal/tasks/process-exports",
      requiresSecret: true,
    },
  },
  {
    id: "activitypub-cleanup",
    title: "ActivityPub cleanup",
    description: "Prune inbox/delivery/rate-limit/actor cache tables.",
    schedule: "0 2 * * *",
    required: true,
  },
];

export type CronValidationResult = {
  configured: string[];
  missingSchedules: Array<{ schedule: string; tasks: CronTaskDefinition[] }>;
  warnings: string[];
  errors: string[];
};

const configuredCronSources = ["CRON_TRIGGERS", "TAKOS_CRON_TRIGGERS", "TRIGGERS_CRONS"];

export function getCronTasks(): CronTaskDefinition[] {
  return CRON_TASKS;
}

export function getCronTasksForSchedule(schedule: string): CronTaskDefinition[] {
  const normalized = normalizeCron(schedule);
  return CRON_TASKS.filter((task) => normalizeCron(task.schedule) === normalized);
}

export function validateCronConfig(env: Bindings): CronValidationResult {
  const configuredRaw =
    configuredCronSources
      .map((key) => (env as any)[key])
      .find((value) => typeof value === "string" && value.trim().length > 0) || "";

  const configured = parseCronList(configuredRaw);
  const warnings: string[] = [];
  const errors: string[] = [];

  if (!configured.length) {
    warnings.push(
      "No cron schedules detected. Set CRON_TRIGGERS (comma-separated or JSON array) to mirror [triggers].crons in wrangler.toml.",
    );
  }

  const scheduleMap = new Map<string, CronTaskDefinition[]>();
  for (const task of CRON_TASKS) {
    const key = normalizeCron(task.schedule);
    const list = scheduleMap.get(key) ?? [];
    list.push(task);
    scheduleMap.set(key, list);
  }

  const missingSchedules: Array<{ schedule: string; tasks: CronTaskDefinition[] }> = [];

  for (const [schedule, tasks] of scheduleMap.entries()) {
    const hasSchedule = configured.some((expr) => expr === schedule);
    if (!hasSchedule) {
      missingSchedules.push({ schedule, tasks });
      const requiredTasks = tasks.filter((task) => task.required);
      if (requiredTasks.length) {
        const names = requiredTasks.map((task) => task.title).join(", ");
        errors.push(`Missing cron schedule "${schedule}" required for: ${names}`);
      }
    }
  }

  const protectedEndpoints = CRON_TASKS.filter(
    (task) => task.endpoint?.requiresSecret,
  );
  if (protectedEndpoints.length && !(env as any).CRON_SECRET) {
    const endpoints = protectedEndpoints.map((task) => task.endpoint?.path ?? "").join(", ");
    warnings.push(
      `CRON_SECRET is not set; cron endpoints (${endpoints}) will accept unauthenticated calls.`,
    );
  }

  return {
    configured,
    missingSchedules,
    warnings,
    errors,
  };
}
