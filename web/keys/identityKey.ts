import { Hono } from "hono";
import { MyEnv } from "../../userInfo.ts";
import {
    isValidIdentityKeyPublic,
    keyHash,
    verifyMasterKey,
} from "@takos/takos-encrypt-ink";
import IdentityKey from "../../models/crypto/identityKey.ts";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

const app = new Hono<MyEnv>();

app.post(
    "/",
    zValidator(
        "json",
        z.object({
            identityKey: z.string(),
            identityKeySign: z.string(),
        }),
    ),
    async (c) => {
        const user = c.get("user");
        const session = c.get("session");
        if (!user || !user.masterKey) {
            return c.json({ message: "Unauthorized" }, 401);
        }
        const { identityKey, identityKeySign } = c.req.valid("json");
        if (!verifyMasterKey(user.masterKey, identityKeySign, identityKey)) {
            return c.json({ message: "Invalid identity key" }, 400);
        }
        const { sessionUuid } = JSON.parse(identityKey);
        if (!sessionUuid) {
            return c.json({ message: "Invalid identity key" }, 400);
        }
        if (session.sessionUUID !== sessionUuid) {
            return c.json({ message: "Invalid identity key" }, 400);
        }
        if (!isValidIdentityKeyPublic(identityKey)) {
            return c.json({ message: "Invalid identity key" }, 400);
        }
        await IdentityKey.updateOne({
            userName: user.userName,
            sessionid: session.sessionid,
        }, {
            updateTime: Date.now(),
        });
        await IdentityKey.create({
            userName: user.userName,
            hash: await keyHash(identityKey),
            identityKey: identityKey,
            sign: identityKeySign,
            sessionid: session.sessionid,
        });
        return c.json({ message: "success" });
    },
);

export default app;
