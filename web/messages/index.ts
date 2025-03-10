import { Hono } from "hono";
import { MyEnv } from "../../userInfo.ts";
const app = new Hono<MyEnv>();

import sendApp from "./send.ts";
import deleteApp from "./delete.ts";
import friendApp from "./friend.ts";
import groupApp from "./group.ts";

app.route("/send", sendApp);
app.route("/delete", deleteApp);
app.route("/friend", friendApp);
app.route("/group", groupApp);

export default app;
