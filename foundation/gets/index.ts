import { Hono } from "hono";
import { cors } from "hono/cors";

// 各ルートモジュールをインポート
import versionRoutes from "./version.ts";
import messageRoutes from "./message.ts";
import serverRoutes from "./server.ts";
import userRoutes from "./user.ts";
import groupRoutes from "./group.ts";
import keyRoutes from "./key.ts";

// メインアプリの作成
const app = new Hono();

// CORSミドルウェアを適用
app.use(cors({
    origin: "*",
}));

// 各モジュールをマウント
app.route("/", versionRoutes);
app.route("/", messageRoutes);
app.route("/", serverRoutes);
app.route("/", userRoutes);
app.route("/", groupRoutes);
app.route("/", keyRoutes);

export default app;
