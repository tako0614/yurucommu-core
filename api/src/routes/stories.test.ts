import { describe, expect, it } from "vitest";

const loadRoutes = () => import("./stories.js");

describe("/internal/tasks/cleanup-stories", () => {
  it("returns a no-op cleanup result for cron compatibility", async () => {
    const { default: storiesRoutes } = await loadRoutes();
    const response = await storiesRoutes.request(
      "/internal/tasks/cleanup-stories",
      { method: "POST" },
      {} as any,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.ok).toBe(true);
    expect(body.data?.skipped).toBe(true);
  }, 20000);
});
