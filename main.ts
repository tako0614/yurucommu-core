import { Hono } from "hono";
import sessions from "./web/sessions/index.ts";
import profile from "./web/profile/index.ts";
import keys from "./web/keys/index.ts";
import server from "./web/server/index.ts";
import mongoose from "mongoose";
import gets from "./foundation/gets/index.ts";
import friend from "./web/friends/index.ts";
import { load } from "@std/dotenv";
import serverKey from "./models/foundation/serverKeys.ts";
import { generateServerKey } from "@takos/takos-encrypt-ink";
import foundationApi from "./foundation/server/eventRoute.ts";
import message from "./web/messages/index.ts";
import ws from "./web/ws.ts";
import groups from "./web/groups/index.ts";
import media from "./web/sns/media.ts";
import sns from "./web/sns/index.ts";
import activityPub from "./activityPub/index.ts";
import call from "./foundation/call/index.ts";
import "./utils/ReidsSubPub.ts";
const env = await load();
const app = new Hono();
const appClient = new Hono();
const appServer = new Hono();
appClient.route("/sessions", sessions);
appClient.route("/profile", profile);
appClient.route("/keys", keys);
appClient.route("/friend", friend);
appClient.route("/server", server);
appClient.route("/message", message);
appClient.route("/group", groups);
appClient.route("/ws", ws);
appClient.route("/sns", sns);
appServer.route("/v1", gets);
appServer.route("/v1/event", foundationApi);
app.route("/_takos", appServer);
app.route("/api/v2", appClient);
app.route("/media", media);
app.route("/", activityPub);
app.route("/_takos/call", call);

await mongoose.connect(String(env["MONGO_URI"]));

if (!await serverKey.findOne({}).sort({ expires: -1 })) {
    const key = generateServerKey();
    console.log("newKey");
    await serverKey.create(key);
}

export default app;
