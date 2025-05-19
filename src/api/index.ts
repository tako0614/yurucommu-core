import mongoose from "mongoose";
import honoApp from "./hono.ts";
import { load } from "jsr:@std/dotenv";

const env = await load();

await mongoose.connect(env["MONGO_URI"])
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("MongoDB connection error:", err));

Deno.serve({
  port: 3001,
  // handler ハンドラをラップして、第二引数に env オブジェクトを渡す
  handler(request: Request) {
    // connInfo が不要なら省略可
    return honoApp.fetch(request, env);
  },
});

export interface Env {
  hashedPassword: string;
  salt: string;
  ACTIVITYPUB_DOMAIN: string;
}
