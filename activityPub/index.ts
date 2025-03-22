import { Hono } from "hono";
import userRoute from "./user.ts";
import webfinger from "./webfinger.ts";
import { cors } from "hono/cors";
const app = new Hono();
// CORSミドルウェアを追加
app.use(cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization", "Accept"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length", "Content-Type"],
}));
// ルートの設定
app.route("/u", userRoute);
app.route("/.well-known/webfinger", webfinger);

app.get("/wordpress/wp-admin/setup-config.php", (c) => {
    return c.body("セックスしよ！！");
});

export default app;
