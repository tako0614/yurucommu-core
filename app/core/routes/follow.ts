import { type Context, Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import authRequired from "../utils/auth.ts";
import { getDB } from "../db/mod.ts";
import { getEnv } from "@takos/config";
import { getDomain, jsonResponse } from "../utils/activitypub.ts";
import { processFollow } from "../services/follow.ts";

const urlValidator = (field: string) =>
  z.string()
    .url({ message: `${field} は有効な URL を指定してください` })
    .refine((v) => v.startsWith("https://"), {
      message: `${field} は https:// で始まる URL を指定してください`,
    });

const followSchema = z.object({
  follower: urlValidator("follower"),
  target: urlValidator("target"),
});

const app = new Hono();
const auth = (c: Context, next: () => Promise<void>) =>
  authRequired(getDB(c))(c, next);
app.use("/follow", auth);

app.post(
  "/follow",
  zValidator("json", followSchema),
  async (c) => {
    const { follower: followerUrl, target: targetUrl } = c.req.valid("json");
    const domain = getDomain(c);
    const env = getEnv(c);
    const db = getDB(c);
    if (followerUrl === targetUrl) {
      return jsonResponse(
        c,
        { error: "自分自身をフォローすることはできません" },
        400,
      );
    }
    const following = await processFollow(
      db,
      env,
      domain,
      followerUrl,
      targetUrl,
      false,
    );
    return jsonResponse(c, { following });
  },
);

app.delete(
  "/follow",
  zValidator("json", followSchema),
  async (c) => {
    const { follower: followerUrl, target: targetUrl } = c.req.valid("json");
    const domain = getDomain(c);
    const env = getEnv(c);
    const db = getDB(c);
    if (followerUrl === targetUrl) {
      return jsonResponse(
        c,
        { error: "自分自身をフォローすることはできません" },
        400,
      );
    }
    const following = await processFollow(
      db,
      env,
      domain,
      followerUrl,
      targetUrl,
      true,
    );
    return jsonResponse(c, { following });
  },
);

export default app;
