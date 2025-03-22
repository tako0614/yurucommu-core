import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import User from "../../models/users/users.ts";
import { hashPassword, verifyPassword } from "../../utils/password.ts";
import { MyEnv } from "../../userInfo.ts";
const app = new Hono<MyEnv>();

app.post(
    "/",
    zValidator(
        "json",
        z.object({
            password: z.string(),
            oldPassword: z.string(),
        }),
    ),
    async (c) => {
        const user = c.get("user");
        if (!user) {
            return c.json({ message: "Unauthorized" }, 401);
        }
        const { password, oldPassword } = c.req.valid("json");
        if (!verifyPassword(oldPassword, user.password, user.salt)) {
            return c.json({ message: "Unauthorized" }, 401);
        }
        const [hash, salt] = await hashPassword(password);
        await User.updateOne({ userName: user.userName }, {
            password: hash,
            salt,
        });
        return c.json({ message: "success" });
    },
);

export default app;
