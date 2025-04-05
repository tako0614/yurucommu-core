import { Hono } from "hono";
import userRoute from "./user.ts";
import webfinger from "./webfinger.ts";
const app = new Hono();
// CORSミドルウェアを追加

// ルートの設定
app.route("/u", userRoute);
app.route("/.well-known/webfinger", webfinger);

app.get("/wordpress/wp-admin/setup-config.php", (c) => {
  return c.body("セックスしよ！！");
});

export default app;
