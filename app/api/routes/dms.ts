import { Hono } from "hono";
import { createDB } from "../DB/mod.ts";
import authRequired from "../utils/auth.ts";
import { getEnv } from "../../shared/config.ts";
import { jsonResponse } from "../utils/activitypub.ts";

const app = new Hono();
app.use("/accounts/*", authRequired);

app.get("/accounts/:id/dms", async (c) => {
  const id = c.req.param("id");
  const db = createDB(getEnv(c));
  const account = await db.findAccountById(id);
  if (!account) return jsonResponse(c, { error: "Account not found" }, 404);
  return jsonResponse(c, { dms: account.dms ?? [] });
});

app.post("/accounts/:id/dms", async (c) => {
  const id = c.req.param("id");
  const { target } = await c.req.json();
  if (
    typeof target !== "string" ||
    !/^[^@]+@[^@]+$/.test(target)
  ) {
    return jsonResponse(c, { error: "invalid target" }, 400);
  }
  const db = createDB(getEnv(c));
  const account = await db.findAccountById(id);
  if (!account) {
    return jsonResponse(c, { error: "Account not found" }, 404);
  }
  const dms = await db.addDm(id, target);
  return jsonResponse(c, { dms });
});

app.delete("/accounts/:id/dms", async (c) => {
  const id = c.req.param("id");
  const { target } = await c.req.json();
  if (
    typeof target !== "string" ||
    !/^[^@]+@[^@]+$/.test(target)
  ) {
    return jsonResponse(c, { error: "invalid target" }, 400);
  }
  const db = createDB(getEnv(c));
  const account = await db.findAccountById(id);
  if (!account) {
    return jsonResponse(c, { error: "Account not found" }, 404);
  }
  const dms = await db.removeDm(id, target);
  return jsonResponse(c, { dms });
});

export default app;
