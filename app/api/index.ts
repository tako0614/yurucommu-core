import mongoose from "mongoose";
import { load } from "jsr:@std/dotenv";
import { Hono } from "hono";
import login from "./login.ts";
import session from "./session.ts";

const env = await load();

await mongoose.connect(env["MONGO_URI"])
  .then(() => console.log("Connected to MongoDB"))
  .catch((err: Error) => console.error("MongoDB connection error:", err));

const app = new Hono();
app.route("/api", login);
app.route("/api", session);

Deno.serve(app.fetch)