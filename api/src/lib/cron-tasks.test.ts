import { describe, expect, it } from "vitest";
import { getCronTasksForSchedule, validateCronConfig } from "./cron-tasks";

describe("cron task registry", () => {
  it("accepts configured schedules", () => {
    const result = validateCronConfig({
      CRON_TRIGGERS: "*/5 * * * *,0 2 * * *",
      CRON_SECRET: "secret",
    } as any);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
    expect(result.configured).toContain("*/5 * * * *");
    expect(result.configured).toContain("0 2 * * *");
  });

  it("detects missing cleanup schedule", () => {
    const result = validateCronConfig({ CRON_TRIGGERS: "*/5 * * * *" } as any);
    expect(result.errors.some((msg) => msg.includes("0 2 * * *"))).toBe(true);
  });

  it("warns when cron secret is absent for protected endpoints", () => {
    const result = validateCronConfig({
      CRON_TRIGGERS: "*/5 * * * *,0 2 * * *",
    } as any);
    expect(result.warnings.some((msg) => msg.includes("CRON_SECRET"))).toBe(true);
  });

  it("returns tasks for a schedule", () => {
    const tasks = getCronTasksForSchedule("*/5 * * * *");
    expect(tasks.length).toBeGreaterThan(1);
    expect(tasks.every((task) => task.schedule === "*/5 * * * *")).toBe(true);
  });
});
