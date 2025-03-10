import { authorizationMiddleware, MyEnv } from "../../userInfo.ts";
import { Hono } from "hono";
const app = new Hono<MyEnv>();
app.use("*", authorizationMiddleware);

import iconApp from "./icon.ts";
import nickNameApp from "./nickName.ts";
import descriptionApp from "./description.ts";
import passwordApp from "./password.ts";

app.route("/icon", iconApp);
app.route("/nickName", nickNameApp);
app.route("/description", descriptionApp);
app.route("/password", passwordApp);

export default app;
