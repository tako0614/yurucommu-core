import { Hono } from "hono";
import { authorizationMiddleware, MyEnv } from "../../userInfo.ts";
import deviceKeyRouter from "./deviceKey.ts";
import accountKeyRouter from "./accountKey.ts";
import identityKeyRouter from "./identityKey.ts";
import shareSignKeyRouter from "./shareSignKey.ts";
import roomKeyRouter from "./roomKey.ts";

const app = new Hono<MyEnv>();
app.use("*", authorizationMiddleware);

// 各エンドポイントのルーターをマウント
app.route("/deviceKey", deviceKeyRouter);
app.route("/accountKey", accountKeyRouter);
app.route("/identityKey", identityKeyRouter);
app.route("/shareSignKey", shareSignKeyRouter);
app.route("/roomKey", roomKeyRouter);

export default app;
