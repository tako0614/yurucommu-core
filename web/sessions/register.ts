import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import tempUsers from "../../models/users/tempUsers.ts";
import users from "../../models/users/users.ts";
import { hashPassword } from "../../utils/password.ts";
import app from "../../_factory.ts";
import { generatePrivateKeyPem } from "../../activityPub/utils.ts";

app.post(
    "/register",
    zValidator(
        "json",
        z.object({
            token: z.string(),
            password: z.string(),
            userName: z.string(),
        }).strict(),
    ),
    async (c) => {
        const { token, password, userName } = c.req.valid("json");

        const tempUser = await tempUsers.findOne({ token });

        if (!tempUser) {
            return c.json({ status: "error", message: "Invalid token" }, 400);
        }

        if (!tempUser.checked) {
            return c.json({
                status: "error",
                message: "You have not checked your email",
            }, 400);
        }

        if (await users.findOne({ userName })) {
            return c.json({
                status: "error",
                message: "This username is already in use",
            }, 400);
        }

        const [hash, salt] = await hashPassword(password);

        const privateKey = generatePrivateKeyPem();

        await users.create({
            email: tempUser.email,
            password: hash,
            salt,
            userName,
            privateKey,
        });

        await tempUsers.deleteOne({ token });

        return c.json({ status: "success" });
    },
);

export default app;
