import { Hono } from "hono";
import { createDB } from "../DB/mod.ts";
import authRequired from "../utils/auth.ts";
import { getEnv } from "../../shared/config.ts";
import { jsonResponse } from "../utils/activitypub.ts";

// グループ管理 API
const app = new Hono();
app.use("/accounts/*", authRequired);

app.get("/accounts/:id/groups", async (c) => {
  const id = c.req.param("id");
  const db = createDB(getEnv(c));
  const account = await db.findAccountById(id);
  if (!account) return jsonResponse(c, { error: "Account not found" }, 404);
  const groups = await db.listGroups(id);
  return jsonResponse(c, { groups });
});

app.post("/accounts/:id/groups", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  if (
    typeof body !== "object" ||
    typeof body.name !== "string" ||
    !Array.isArray(body.members)
  ) {
    return jsonResponse(c, { error: "invalid group" }, 400);
  }
  const group = {
    id: typeof body.id === "string" ? body.id : crypto.randomUUID(),
    name: body.name,
    members: body.members.filter((m: unknown) => typeof m === "string"),
  };
  const db = createDB(getEnv(c));
  const account = await db.findAccountById(id);
  if (!account) return jsonResponse(c, { error: "Account not found" }, 404);
  const groups = await db.addGroup(id, group);
  return jsonResponse(c, { groups });
});

app.delete("/accounts/:id/groups", async (c) => {
  const id = c.req.param("id");
  const { id: groupId } = await c.req.json();
  if (typeof groupId !== "string") {
    return jsonResponse(c, { error: "invalid group id" }, 400);
  }
  const db = createDB(getEnv(c));
  const account = await db.findAccountById(id);
  if (!account) return jsonResponse(c, { error: "Account not found" }, 404);
  const groups = await db.removeGroup(id, groupId);
  return jsonResponse(c, { groups });
});

export default app;
