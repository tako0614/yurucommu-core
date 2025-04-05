import { Context, Next } from "hono";
import { Hono } from "hono";
import { Env } from "./_factory.ts";
import remoteServerKey from "./models/foundation/remoteServerKey.ts";
import { verifyData } from "@takos/takos-encrypt-ink";
import EventId from "./models/foundation/eventId.ts";

export type MyEnv = {
  Variables: {
    domain: string;
    eventId: string;
  };
  Bindings: Env;
};

export const authorizationMiddleware = async (
  c: Context<MyEnv>,
  next: Next,
) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader) {
    return c.json({ error: "Authorization header is missing" }, 401);
  }
  //const authHeader = `sign="AAAAAAACw4QFx8p",expires="2025-02-25T21:59:12.769Z",domain="dev2.takos.jp"`
  const sign = authHeader.match(/sign="(.+?)"/)?.[1];
  const expires = authHeader.match(/expire="(.+?)"/)?.[1];
  const domain = authHeader.match(/origin="(.+?)"/)?.[1];
  if (!sign || !expires || !domain) {
    return c.json({ error: "Invalid Authorization header" }, 401);
  }
  const pubKey = await remoteServerKey.findOne({
    domain,
    expire: new Date(expires),
  });
  let eventId;
  if (!pubKey) {
    const serverKeyRes = await fetch(
      `https://${domain}/_takos/v1/key/server?expire=${expires}`,
    );
    if (serverKeyRes.status !== 200) {
      return c.json({ error: "Invalid Authorization" }, 401);
    }
    const serverKeyData = await serverKeyRes.json();
    const bodyText = await c.req.text();
    const verify = verifyData(
      bodyText,
      sign,
      serverKeyData.key,
    );
    await remoteServerKey.create({
      domain,
      expire: new Date(expires),
      public: serverKeyData.key,
    });
    if (!verify) {
      return c.json({ error: "Invalid Authorization" }, 401);
    }
  } else {
    console.log("pubKey");
    const bodyText = await c.req.text();
    const verify = verifyData(bodyText, sign, pubKey.public);
    if (!verify) {
      return c.json({ error: "Invalid Authorization" }, 401);
    }
    eventId = JSON.parse(bodyText).eventId;
    if (!eventId) {
      return c.json({ error: "Invalid Authorization" }, 401);
    }
    if (await EventId.findOne({ eventId })) {
      return c.json({ error: "Invalid Authorization" }, 401);
    }
  }
  c.set("domain", domain);
  c.set("eventId", eventId);
  await next();
  console.log(eventId);
  await EventId.create({
    eventId,
    domain,
    timestamp: new Date(),
  });
};

const app = new Hono<MyEnv>();
app.use("*", authorizationMiddleware);

export default app;
