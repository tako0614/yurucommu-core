import { Hono } from "hono";
import { getDomain } from "@core/utils/activitypub.ts";
import { createDB } from "@takos_host/db";
import type { GroupDoc } from "@takos/types";

/**
 * テナント情報を考慮したグループルート
 */
export function createGroupsHostApp(env: Record<string, string>) {
  const app = new Hono();

  function isOwnedGroup(
    group: GroupDoc & { tenant_id?: string },
    domain: string,
    name: string,
  ): boolean {
    const tenant = group.tenant_id;
    if (tenant && tenant !== domain) return false;
    const id = `https://${domain}/groups/${group.groupName}`;
    return id === `https://${domain}/groups/${name}`;
  }

  // グループをテナント付きで取得
  app.get("/api/groups/:name", async (c) => {
    const name = c.req.param("name");
    const domain = getDomain(c);
    const db = createDB(env);
    const group = await db.findGroupByName(name) as
      | (GroupDoc & { tenant_id?: string })
      | null;
    if (!group) return c.json({ error: "見つかりません" }, 404);
    if (!isOwnedGroup(group, domain, name)) {
      return c.json({ error: "他ホストのグループです" }, 403);
    }
    return c.json(group);
  });

  return app;
}
