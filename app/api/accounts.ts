import { Hono } from "hono";
import Account from "./models/account.ts";
import type { Document } from "mongoose";

interface AccountDoc extends Document {
  userName: string;
  displayName: string;
  avatarInitial: string;
}

const app = new Hono();

app.get("/accounts", async (c) => {
  const list = await Account.find().lean<AccountDoc>();
  const formatted = list.map((doc) => ({
    id: doc._id.toString(),
    userName: doc.userName,
    displayName: doc.displayName,
    avatarInitial: doc.avatarInitial,
  }));
  return c.json(formatted);
});

app.post("/accounts", async (c) => {
  const { username, displayName, icon } = await c.req.json();
  const account = new Account({
    userName: username,
    displayName: displayName ?? username,
    avatarInitial: icon ?? (username.charAt(0).toUpperCase()).substring(0, 2),
  });
  await account.save();
  return c.json({
    id: account._id.toString(),
    userName: account.userName,
    displayName: account.displayName,
    avatarInitial: account.avatarInitial,
  });
});

app.put("/accounts/:id", async (c) => {
  const id = c.req.param("id");
  const updates = await c.req.json();
  const data: Record<string, unknown> = {};
  if (updates.userName) data.userName = updates.userName;
  if (updates.displayName) data.displayName = updates.displayName;
  if (updates.avatarInitial !== undefined) {
    data.avatarInitial = updates.avatarInitial;
  }

  const account = await Account.findByIdAndUpdate(id, data, { new: true });
  if (!account) return c.json({ error: "Account not found" }, 404);
  return c.json({
    id: account._id.toString(),
    userName: account.userName,
    displayName: account.displayName,
    avatarInitial: account.avatarInitial,
  });
});

app.delete("/accounts/:id", async (c) => {
  const id = c.req.param("id");
  const account = await Account.findByIdAndDelete(id);
  if (!account) return c.json({ error: "Account not found" }, 404);
  return c.json({ success: true });
});

export default app;
