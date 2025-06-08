import mongoose from "mongoose";
import honoApp from "./hono.ts";
import { WebSocketEventServer } from "./eventDistributionServer.ts";
import { initExtensions } from "./utils/extensionsRuntime.ts";
import { load } from "jsr:@std/dotenv";

const env = await load();

await mongoose.connect(env["MONGO_URI"])
  .then(() => console.log("Connected to MongoDB"))
  .catch((err: any) => console.error("MongoDB connection error:", err));

// WebSocketイベント配信サーバーを初期化
const wsEventServer = new WebSocketEventServer(3002);
wsEventServer.start();
console.log("WebSocket event server started on port 3002");

await initExtensions();

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
