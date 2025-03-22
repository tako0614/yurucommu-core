import { Hono } from "hono";
import { MyEnv } from "../../userInfo.ts";
import { keyHash, verifyMasterKey } from "@takos/takos-encrypt-ink";
import shareSignKey from "../../models/crypto/shareSignKey.ts";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

const app = new Hono<MyEnv>();

app.post(
    "/",
    zValidator(
        "json",
        z.object({
            shareSignKey: z.string(),
            shareSignKeySign: z.string(),
        }),
    ),
    async (c) => {
        const user = c.get("user");
        if (!user || !user.masterKey) {
            return c.json({ message: "Unauthorized" }, 401);
        }
        const { shareSignKey: shareSignKeyValue, shareSignKeySign } = c.req
            .valid(
                "json",
            );
        if (
            !verifyMasterKey(
                user.masterKey,
                shareSignKeySign,
                shareSignKeyValue,
            )
        ) {
            return c.json({ message: "Invalid share sign key" }, 400);
        }
        await shareSignKey.create({
            userName: user.userName,
            sessionid: c.get("session").sessionid,
            sign: shareSignKeySign,
            timestamp: Date.now(),
            hash: await keyHash(shareSignKeyValue),
            shareSignKey: shareSignKeyValue,
        });
        return c.json({ message: "success" });
    },
);

app.get("/", async (c) => {
    const user = c.get("user");
    if (!user) {
        return c.json({ message: "Unauthorized" }, 401);
    }
    const hash = c.req.query("hash");
    const shareSignKeyValue = await shareSignKey.findOne({
        userName: user.userName,
        hash,
    });
    if (!shareSignKeyValue) {
        return c.json({ message: "Unauthorized" }, 401);
    }
    return c.json({
        shareSignKey: shareSignKeyValue.shareSignKey,
        sign: shareSignKeyValue.sign,
    });
});

export default app;
