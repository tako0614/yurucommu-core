import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import User from "../../models/users/users.ts";
import { MyEnv } from "../../userInfo.ts";
const app = new Hono<MyEnv>();

app.post(
  "/",
  zValidator(
    "json",
    z.object({
      nickName: z.string(),
    }),
  ),
  async (c) => {
    const user = c.get("user");
    if (!user) {
      return c.json({ message: "Unauthorized" }, 401);
    }
    const { nickName } = c.req.valid("json");
    await User.updateOne({ userName: user.userName }, { nickName });
    return c.json({ message: "success" });
  },
);

export default app;
