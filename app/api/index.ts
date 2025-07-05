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
app.route("/api", users);
app.route("/api", activitypub); // ActivityPubプロキシAPI用
app.route("/", activitypub);

Deno.serve(app.fetch);
