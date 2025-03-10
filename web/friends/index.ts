import { Hono } from "hono";
import { authorizationMiddleware, MyEnv } from "../../userInfo.ts";
import requestSend from "./requestSend.ts";
import requestList from "./requestList.ts";
import acceptRequest from "./acceptRequest.ts";
import friendList from "./friendList.ts";

const app = new Hono<MyEnv>();

// すべてのエンドポイントに認証ミドルウェアを適用
app.use("*", authorizationMiddleware);

// 各エンドポイントをマウント
app.route("/request", requestSend);
app.route("/requests", requestList);
app.route("/accept", acceptRequest);
app.route("/list", friendList);

export default app;
