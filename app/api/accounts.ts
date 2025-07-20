import { Hono } from "hono";
import {
  addFollower,
  addFollowerByName,
  addFollowing,
  createAccount,
  deleteAccountById,
  findAccountById,
  findAccountByUserName,
  listAccounts,
  removeFollower,
  removeFollowerByName,
  removeFollowing,
  updateAccountById,
} from "./repositories/account.ts";
import {
  createFollowActivity,
  createUndoFollowActivity,
  deliverActivityPubObject,
  fetchActorInbox,
  getDomain,
  jsonResponse,
} from "./utils/activitypub.ts";
import authRequired from "./utils/auth.ts";
import { addNotification } from "./services/notification.ts";
import { createDB } from "./db.ts";
import { getEnv } from "../../shared/config.ts";
import { generateKeyPair } from "../../shared/crypto.ts";

interface AccountDoc {
  _id?: string;
  userName: string;
  displayName: string;
  avatarInitial: string;
  privateKey: string;
  publicKey: string;
  followers: string[];
  following: string[];
}

function formatAccount(doc: AccountDoc) {
  return {
    id: String(doc._id),
    userName: doc.userName,
    displayName: doc.displayName,
    avatarInitial: doc.avatarInitial,
    publicKey: doc.publicKey,
    followers: doc.followers,
    following: doc.following,
  };
}

const app = new Hono();
app.use("/accounts/*", authRequired);

app.get("/accounts", async (c) => {
  const env = getEnv(c);
  const list = await listAccounts(env);
  const formatted = list.map((doc: AccountDoc) => formatAccount(doc));
  return jsonResponse(c, formatted);
});

app.post("/accounts", async (c) => {
  const env = getEnv(c);
  const { username, displayName, icon, privateKey, publicKey } = await c.req
    .json();

  // userName is required and cannot be changed after creation
  if (!username || typeof username !== "string" || username.trim() === "") {
    return jsonResponse(c, {
      error: "Username is required and cannot be empty",
    }, 400);
  }

  if (username.trim() === "system") {
    return jsonResponse(c, { error: "このユーザー名は使用できません" }, 400);
  }

  // Check if username already exists
  const existingAccount = await findAccountByUserName(env, username.trim());
  if (existingAccount) {
    return jsonResponse(c, { error: "Username already exists" }, 409);
  }

  const keys = privateKey && publicKey
    ? { privateKey, publicKey }
    : await generateKeyPair();
  const account = await createAccount(env, {
    userName: username.trim(),
    displayName: displayName ?? username.trim(),
    avatarInitial: icon ??
      username.trim().charAt(0).toUpperCase().substring(0, 2),
    privateKey: keys.privateKey,
    publicKey: keys.publicKey,
    followers: [],
    following: [],
  });
  return jsonResponse(c, formatAccount(account));
});

app.get("/accounts/:id", async (c) => {
  const env = getEnv(c);
  const id = c.req.param("id");
  const account = await findAccountById(env, id);
  if (!account) return jsonResponse(c, { error: "Account not found" }, 404);
  return jsonResponse(c, {
    ...formatAccount(account),
    privateKey: account.privateKey,
  });
});

app.put("/accounts/:id", async (c) => {
  const env = getEnv(c);
  const id = c.req.param("id");
  const updates = await c.req.json();
  const data: Record<string, unknown> = {};
  // userName is immutable after creation - removed from update logic
  if (updates.displayName) data.displayName = updates.displayName;
  if (updates.avatarInitial !== undefined) {
    data.avatarInitial = updates.avatarInitial;
  }
  if (updates.privateKey) data.privateKey = updates.privateKey;
  if (updates.publicKey) data.publicKey = updates.publicKey;
  if (Array.isArray(updates.followers)) data.followers = updates.followers;
  if (Array.isArray(updates.following)) data.following = updates.following;

  const account = await updateAccountById(env, id, data);
  if (!account) return jsonResponse(c, { error: "Account not found" }, 404);
  return jsonResponse(c, formatAccount(account));
});

app.post("/accounts/:id/followers", async (c) => {
  const env = getEnv(c);
  const id = c.req.param("id");
  const { follower } = await c.req.json();
  const exists = await findAccountById(env, id);
  if (!exists) return jsonResponse(c, { error: "Account not found" }, 404);
  const followers = await addFollower(env, id, follower);
  return jsonResponse(c, { followers });
});

app.delete("/accounts/:id/followers", async (c) => {
  const env = getEnv(c);
  const id = c.req.param("id");
  const { follower } = await c.req.json();
  const exists = await findAccountById(env, id);
  if (!exists) return jsonResponse(c, { error: "Account not found" }, 404);
  const followers = await removeFollower(env, id, follower);
  return jsonResponse(c, { followers });
});

app.post("/accounts/:id/following", async (c) => {
  const env = getEnv(c);
  const id = c.req.param("id");
  const { target } = await c.req.json();
  const exists = await findAccountById(env, id);
  if (!exists) return jsonResponse(c, { error: "Account not found" }, 404);
  const following = await addFollowing(env, id, target);
  return jsonResponse(c, { following });
});

app.get("/accounts/:id/following", async (c) => {
  const env = getEnv(c);
  const id = c.req.param("id");
  const account = await findAccountById(env, id);
  if (!account) return jsonResponse(c, { error: "Account not found" }, 404);
  return jsonResponse(c, { following: account.following });
});

app.delete("/accounts/:id/following", async (c) => {
  const env = getEnv(c);
  const id = c.req.param("id");
  const { target } = await c.req.json();
  const exists = await findAccountById(env, id);
  if (!exists) return jsonResponse(c, { error: "Account not found" }, 404);
  const following = await removeFollowing(env, id, target);
  return jsonResponse(c, { following });
});

app.post("/accounts/:id/follow", async (c) => {
  const env = getEnv(c);
  const db = createDB(env);
  const id = c.req.param("id");
  const { target, userName } = await c.req.json();
  if (typeof target !== "string" || typeof userName !== "string") {
    return jsonResponse(c, { error: "Invalid body" }, 400);
  }
  const accountExist = await findAccountById(env, id);
  if (!accountExist) {
    return jsonResponse(c, { error: "Account not found" }, 404);
  }
  const following = await addFollowing(env, id, target);

  try {
    const domain = getDomain(c);
    const actorId = `https://${domain}/users/${userName}`;
    const targetUrl = new URL(target);
    if (targetUrl.host === domain && targetUrl.pathname.startsWith("/users/")) {
      const username = targetUrl.pathname.split("/")[2];
      await addFollowerByName(env, username, actorId);
    } else {
      const inbox = await fetchActorInbox(target, getEnv(c));
      if (inbox) {
        const follow = createFollowActivity(domain, actorId, target);
        deliverActivityPubObject([inbox], follow, userName, domain, getEnv(c))
          .catch((err) => console.error("Delivery failed:", err));
      }
      await db.follow(userName, target);
    }
  } catch (err) {
    console.error("Follow request failed:", err);
  }

  try {
    const domain = getDomain(c);
    let localTarget: string | null = null;
    if (target.startsWith("http")) {
      const url = new URL(target);
      if (url.hostname === domain && url.pathname.startsWith("/users/")) {
        localTarget = url.pathname.split("/")[2];
      }
    } else {
      localTarget = target;
    }
    if (localTarget) {
      await addNotification(
        "新しいフォロー",
        `${userName}さんが${localTarget}さんをフォローしました`,
        "info",
        env,
      );
    }
  } catch {
    /* ignore */
  }

  return jsonResponse(c, { following });
});

app.delete("/accounts/:id/follow", async (c) => {
  const env = getEnv(c);
  const db = createDB(env);
  const id = c.req.param("id");
  const { target } = await c.req.json();
  if (typeof target !== "string") {
    return jsonResponse(c, { error: "Invalid body" }, 400);
  }
  const accountExist = await findAccountById(env, id);
  if (!accountExist) {
    return jsonResponse(c, { error: "Account not found" }, 404);
  }
  const following = await removeFollowing(env, id, target);

  try {
    const domain = getDomain(c);
    const actorId = `https://${domain}/users/${accountExist.userName}`;
    const targetUrl = new URL(target);
    if (targetUrl.host === domain && targetUrl.pathname.startsWith("/users/")) {
      const username = targetUrl.pathname.split("/")[2];
      await removeFollowerByName(env, username, actorId);
    } else {
      const inbox = await fetchActorInbox(target, getEnv(c));
      if (inbox) {
        const undo = createUndoFollowActivity(domain, actorId, target);
        deliverActivityPubObject(
          [inbox],
          undo,
          accountExist.userName,
          domain,
          getEnv(c),
        ).catch(
          (err) => console.error("Delivery failed:", err),
        );
      }
      if (db.unfollow) {
        await db.unfollow(accountExist.userName, target);
      }
    }
  } catch (err) {
    console.error("Unfollow request failed:", err);
  }

  return jsonResponse(c, { following });
});

app.delete("/accounts/:id", async (c) => {
  const env = getEnv(c);
  const id = c.req.param("id");
  const deleted = await deleteAccountById(env, id);
  if (!deleted) return jsonResponse(c, { error: "Account not found" }, 404);
  return jsonResponse(c, { success: true });
});

export default app;
