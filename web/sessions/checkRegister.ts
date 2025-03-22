import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import tempUsers from "../../models/users/tempUsers.ts";
import app from "../../_factory.ts";

app.post(
    "/register/check",
    zValidator(
        "json",
        z.object({
            token: z.string(),
            checkCode: z.string(),
        }).strict(),
    ),
    async (c) => {
        const { token, checkCode } = c.req.valid("json");

        const tempUser = await tempUsers.findOne({ token, checkCode });

        if (!tempUser) {
            await tempUsers.updateOne({ token }, { $inc: { missCheck: 1 } });
            return c.json(
                { status: "error", message: "Invalid token or checkCode" },
                400,
            );
        }

        if (tempUser.missCheck >= 3) {
            return c.json({
                status: "error",
                message: "You have tried too many times",
            }, 400);
        }

        await tempUsers.updateOne({ token }, { checked: true });

        return c.json({ status: "success" });
    },
);

export default app;
