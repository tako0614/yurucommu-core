import { Hono } from "hono";
import { MyEnv } from "../../userInfo.ts";
import { generateDeviceKey } from "@takos/takos-encrypt-ink";
import Session from "../../models/users/sessions.ts";

const app = new Hono<MyEnv>();

app.get("/", (c) => {
  const session = c.get("session");
  if (!session) {
    return c.json({ message: "Unauthorized" }, 401);
  }
  return c.json({ deviceKey: session.deviceKey });
});

app.post("/", async (c) => {
  const deviceKey = await generateDeviceKey();
  const session = c.get("session");
  if (!session) {
    return c.json({ message: "Unauthorized" }, 401);
  }
  Session.updateOne({ sessionid: session.sessionid }, { deviceKey });
  return c.json({ deviceKey });
});

export default app;
