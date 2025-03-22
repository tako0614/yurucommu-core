import { Hono } from "hono";
import { load } from "@std/dotenv";
import { cors } from "hono/cors";

// 環境変数のロード
export const env = await load();

// ユーティリティ関数
export function escapeRegex(text: string) {
    return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
}

// ベースアプリケーション
export function createBaseApp() {
    const app = new Hono();
    app.use(cors({
        origin: "*",
    }));
    return app;
}
