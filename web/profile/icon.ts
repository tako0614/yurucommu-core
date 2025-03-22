import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
    arrayBufferToBase64,
    base64ToArrayBuffer,
} from "https://jsr.io/@takos/takos-encrypt-ink/5.3.2/utils/buffers.ts";
import User from "../../models/users/users.ts";
import { resizeImageTo256x256 } from "../sessions/utils.ts";
import { MyEnv } from "../../userInfo.ts";
const app = new Hono<MyEnv>();

app.post(
    "/",
    zValidator(
        "json",
        z.object({
            icon: z.string(),
        }),
    ),
    async (c) => {
        const user = c.get("user");
        if (!user) {
            return c.json({ message: "Unauthorized" }, 401);
        }
        const { icon } = c.req.valid("json");
        const resizedIcon = await resizeImageTo256x256(
            new Uint8Array(base64ToArrayBuffer(icon)),
        );
        const buffer = resizedIcon.buffer;
        await User.updateOne({ userName: user.userName }, {
            icon: arrayBufferToBase64(buffer as ArrayBuffer),
        });
        return c.json({ message: "success" });
    },
);

export default app;
