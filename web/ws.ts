import { upgradeWebSocket } from "hono/deno";
import { Hono } from "hono";
const app = new Hono();
import { WSContext } from "hono/ws";
import redis from "redis";
import { load } from "@std/dotenv";
import Session from "../models/users/sessions.ts";
import MigrateData from "../models/crypto/migrateData.ts";
import User from "../models/users/users.ts";
import { getCookie } from "hono/cookie";
const env = await load();
const redisURL = env["REDIS_URL"];
const redisch = env["REDIS_CH"];
const subClient = redis.createClient({
  url: redisURL,
});
await subClient.connect();
async function subscribeMessage(channel: string | string[]) {
  await subClient.subscribe(channel, async (message: string) => {
    const data: {
      type: string;
      users: string[];
      data: string;
    } = JSON.parse(message);
    if (data.type === "message") {
      const { users, data: message } = data;
      for (const user of users) {
        if (user.includes("@") === false) {
          return;
        }
        if (user.split("@")[1] !== env["domain"]) {
          return;
        }
        const sessionids = (await Session.find({
          userName: user.split("@")[0],
        })).map((session) => session.sessionid);
        for (const sessionid of sessionids) {
          const ws = sessions.get(sessionid);
          if (ws) {
            ws.ws.send(JSON.stringify({
              type: "message",
              data: message,
            }));
          }
        }
      }
    }
    if (data.type === "migrateRequest") {
      const { users, data: message } = data;
      for (const user of users) {
        if (user.includes("@") === false) {
          return;
        }
        if (user.split("@")[1] !== env["domain"]) {
          return;
        }
        const sessionids = (await Session.find({
          userName: user.split("@")[0],
        })).map((session) => session.sessionid);
        for (const sessionid of sessionids) {
          const ws = sessions.get(sessionid);
          if (ws) {
            const { migrateid, requesterSessionid } = JSON.parse(message);
            if (requesterSessionid === sessionid) {
              return;
            }
            const migrateKey = await MigrateData.findOne({
              migrateid,
            });
            if (!migrateKey) return;
            ws.ws.send(JSON.stringify({
              type: "migrateRequest",
              data: JSON.stringify({
                migrateid,
                migrateKey: migrateKey.migrateKey,
              }),
            }));
          }
        }
      }
    }
    if (data.type === "migrateAccept") {
      const { users, data: message } = data;
      for (const user of users) {
        if (user.includes("@") === false) {
          return;
        }
        if (user.split("@")[1] !== env["domain"]) {
          return;
        }
        const sessionids = (await Session.find({
          userName: user.split("@")[0],
        })).map((session) => session.sessionid);
        for (const sessionid of sessionids) {
          const ws = sessions.get(sessionid);
          if (ws) {
            const { migrateid, requesterSessionid } = JSON.parse(message);
            if (requesterSessionid != sessionid) {
              console.log("migrateid2");
              continue;
            }
            console.log("migrateid");
            const migrateKey = await MigrateData.findOne({
              migrateid,
            });
            if (!migrateKey) continue;
            ws.ws.send(JSON.stringify({
              type: "migrateAccept",
              data: JSON.stringify({
                migrateid,
                migrateSignKey: migrateKey.migrateSignKey,
              }),
            }));
          }
        }
      }
    }
    if (data.type === "migrateData") {
      const { users, data: message } = data;
      for (const user of users) {
        if (user.includes("@") === false) {
          return;
        }
        if (user.split("@")[1] !== env["domain"]) {
          return;
        }
        const sessionids = (await Session.find({
          userName: user.split("@")[0],
        })).map((session) => session.sessionid);
        for (const sessionid of sessionids) {
          const ws = sessions.get(sessionid);
          if (ws) {
            const { migrateid, requesterSessionid } = JSON.parse(message);
            if (requesterSessionid !== sessionid) {
              continue;
            }
            const migrateKey = await MigrateData.findOne({
              migrateid,
            });
            if (!migrateKey) continue;
            ws.ws.send(JSON.stringify({
              type: "migrateData",
              data: JSON.stringify({
                migrateid,
                data: migrateKey.migrateData,
                sign: migrateKey.sign,
              }),
            }));
          }
        }
      }
    }
  });
}
const sessions = new Map<
  string,
  { ws: WSContext; subGroup: string; userId: string }
>();
await subscribeMessage(redisch);

app.get(
  "/",
  upgradeWebSocket(async (c) => {
    // クエリパラメータまたはクッキーからセッションIDを取得
    let sessionid = c.req.query("sessionid");
    if (!sessionid) {
      sessionid = getCookie(c , "sessionid");
    }
    console.log("sessionid", sessionid);
    if (sessionid) {
      const sessionData = await Session.findOne({ sessionid });
      if (sessionData) {
        c.set("session", sessionData);
        const userName = sessionData.userName;
        c.set("user", { userName });
      }
    }

    return {
      onClose: () => {
        const user = c.get("user");
        if (user) {
          sessions.delete(user.userName);
        }
      },
      onOpen: async (_evt, ws) => {
        const session = c.get("session");
        if (!session) {
          ws.close();
          return;
        }
        const user = await User.findOne({ userName: session.userName });
        c.set("user", user);
        if (!user) {
          ws.close();
          return;
        }
        sessions.set(session.sessionid, {
          ws,
          subGroup: "",
          userId: user.userName + "@" + env["domain"],
        });
      },
      onMessage: (evt) => {
        const session = c.get("session");
        if (!session) return;
        const ws = sessions.get(session.sessionid);
        if (!ws) return;
        if (typeof evt.data !== "string") {
          return;
        }
        const data: {
          type: string;
          data: string;
        } = JSON.parse(evt.data);
        if (data.type === "subGroup") {
          ws.subGroup = data.data;
          sessions.set(session.sessionid, {
            ws: ws.ws,
            subGroup: data.data,
            userId: ws.userId,
          });
        }
      },
    };
  }),
);

export default app;
