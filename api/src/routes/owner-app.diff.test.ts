import { afterEach, describe, expect, it } from "vitest";
import ownerAppRoutes from "./owner-app";
import { getDefaultDataFactory, setBackendDataFactory } from "../data";

const authEnv = { AUTH_USERNAME: "admin", AUTH_PASSWORD: "secret" };
const authHeader = `Basic ${Buffer.from("admin:secret").toString("base64")}`;

const manifestA = {
  schemaVersion: "1.0.0",
  routes: [{ id: "route.home", method: "GET", path: "/" }],
  views: { screens: [], insert: [] },
  ap: { handlers: [] },
  data: { collections: {} },
  storage: { buckets: {} },
};

const manifestB = {
  schemaVersion: "1.0.0",
  routes: [
    { id: "route.home", method: "GET", path: "/home" },
    { id: "route.profile", method: "GET", path: "/profile" },
  ],
  views: { screens: [], insert: [] },
  ap: { handlers: [] },
  data: { collections: {} },
  storage: { buckets: {} },
};

const defaultFactory = getDefaultDataFactory();

describe("/admin/app/revisions/diff", () => {
  afterEach(() => {
    setBackendDataFactory(defaultFactory);
  });

  it("returns JSON diff for the latest revisions", async () => {
    setBackendDataFactory(
      () =>
        ({
          listAppRevisions: async () => [
            { id: "revB", manifest_snapshot: JSON.stringify(manifestB), script_snapshot_ref: "hash-b" },
            { id: "revA", manifest_snapshot: JSON.stringify(manifestA), script_snapshot_ref: "hash-a" },
          ],
        }) as any,
    );

    const res = await ownerAppRoutes.request(
      "/admin/app/revisions/diff",
      { method: "GET", headers: { Authorization: authHeader } },
      authEnv,
    );

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.ok).toBe(true);
    const routeChanges =
      (json.sections?.routes?.added?.length || 0) +
      (json.sections?.routes?.removed?.length || 0) +
      (json.sections?.routes?.changed?.length || 0);
    expect(routeChanges).toBeGreaterThan(0);
  });

  it("renders HTML when requested", async () => {
    setBackendDataFactory(
      () =>
        ({
          listAppRevisions: async () => [
            { id: "revB", manifest_snapshot: JSON.stringify(manifestB), script_snapshot_ref: "hash-b" },
            { id: "revA", manifest_snapshot: JSON.stringify(manifestA), script_snapshot_ref: "hash-a" },
          ],
        }) as any,
    );

    const res = await ownerAppRoutes.request(
      "/admin/app/revisions/diff?format=html",
      { method: "GET", headers: { Authorization: authHeader, Accept: "text/html" } },
      authEnv,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")?.toLowerCase() || "").toContain("text/html");
    const body = await res.text();
    expect(body).toContain("App Revision Diff");
    expect(body).toContain("revB");
  });
});
