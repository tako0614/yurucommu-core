import { Hono } from "hono";
import { Env } from "hono";
import { load } from "@std/dotenv";
import User from "../models/users/users.ts";
import { cors } from "hono/cors";
const env = await load();
const app = new Hono<Env>();

const strHost = env["domain"];

app.use(cors({
  origin: "/.well-known/webfinger",
  allowHeaders: ["Content-Type", "Authorization", "Accept"],
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  exposeHeaders: ["Content-Length", "Content-Type"],
}));

app.get("/", async (c) => {
  const resource = c.req.query("resource");
  if (!resource) return c.notFound();

  // デバッグ用のログを追加

  // acct:username@hostname 形式からユーザー名を抽出
  const match = resource.match(/^acct:([^@]+)@(.+)$/);
  if (!match || match[2] !== strHost) return c.notFound();
  const strName = match[1];

  // データベースでユーザーの存在を確認
  const user = await User.findOne({ userName: strName });
  if (!user) return c.notFound();
  const r = {
    subject: `acct:${strName}@${strHost}`,
    aliases: [
      `https://${strHost}/@${strName}`,
      `https://${strHost}/u/${strName}`,
    ],
    links: [
      {
        rel: "self",
        type: "application/activity+json",
        href: `https://${strHost}/u/${strName}`,
      },
      {
        rel: "http://webfinger.net/rel/profile-page",
        type: "text/html",
        href: `https://${strHost}/@${strName}`,
      },
      {
        rel: "http://ostatus.org/schema/1.0/subscribe",
        template: `https://${strHost}/authorize_interaction?uri={uri}`,
      },
    ],
  };
  return c.json(r, 200, {
    "Content-Type": "application/jrd+json",
    "Access-Control-Allow-Origin": "*",
  });
});

export default app;
