import mongoose from "mongoose";
import { load } from "jsr:@std/dotenv";
import { Hono } from "hono";
import login from "./login.ts";
import session from "./session.ts";
import accounts from "./accounts.ts";
import notifications from "./notifications.ts";
import activitypub from "./activitypub.ts";
import microblog from "./microblog.ts";
import search from "./search.ts";
import communities from "./communities.ts";
import users from "./users.ts";
import userInfo from "./user-info.ts";
import group from "./group.ts";
import rootInbox from "./root_inbox.ts";
import nodeinfo from "./nodeinfo.ts";
import e2ee from "./e2ee.ts";
import relays from "./relays.ts";

const env = await load();

await mongoose.connect(env["MONGO_URI"])
  .then(() => console.log("Connected to MongoDB"))
  .catch((err: Error) => console.error("MongoDB connection error:", err));

const app = new Hono();
app.route("/api", login);
app.route("/api", session);
app.route("/api", accounts);
app.route("/api", notifications);
app.route("/api", microblog);
app.route("/api", search);
app.route("/api", communities);
app.route("/api", relays);
app.route("/api", users);
app.route("/api", userInfo);
app.route("/api", e2ee);
app.route("/api", activitypub); // ActivityPubプロキシAPI用
app.route("/api", group);
app.route("/", nodeinfo);
app.route("/", e2ee);
app.route("/", activitypub);
app.route("/", group);
app.route("/", rootInbox);

Deno.serve(app.fetch);
