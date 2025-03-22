import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import z from "zod";
import Session from "../../models/users/sessions.ts";
import users from "../../models/users/users.ts";
import shareAccountKey from "../../models/crypto/shareAccountKey.ts";
import accountKeyData from "../../models/crypto/accountKey.ts";
import {
    isValidAccountKeyPublic,
    isValidMasterKeyPublic,
    isValidShareKeyPublic,
    keyHash,
    verifyMasterKey,
} from "@takos/takos-encrypt-ink";

const app = new Hono();

app.post(
    "/",
    zValidator(
        "json",
        z.object({
            masterKey: z.string(),
            accountKey: z.string(),
            accountKeySign: z.string(),
            shareKey: z.string(),
            shareKeySign: z.string(),
        }).strict(),
    ),
    zValidator(
        "cookie",
        z.object({
            sessionid: z.string(),
        }),
    ),
    async (c) => {
        const {
            masterKey,
            accountKey,
            accountKeySign,
            shareKey,
            shareKeySign,
        } = c
            .req.valid("json");
        const sessionid = c.req.valid("cookie").sessionid;
        const session = await Session.findOne({ sessionid });
        if (!session) {
            return c.json({ status: "error", message: "Invalid session" }, 400);
        }
        if (
            !isValidMasterKeyPublic(masterKey) ||
            !isValidAccountKeyPublic(accountKey) ||
            !isValidShareKeyPublic(shareKey)
        ) {
            return c.json(
                { status: "error", message: "Invalid masterKey" },
                400,
            );
        }
        if (!verifyMasterKey(masterKey, accountKeySign, accountKey)) {
            return c.json(
                { status: "error", message: "Invalid accountKey" },
                400,
            );
        }
        if (!verifyMasterKey(masterKey, shareKeySign, shareKey)) {
            return c.json(
                { status: "error", message: "Invalid shareKey" },
                400,
            );
        }
        await shareAccountKey.deleteMany({ userName: session.userName });
        await Session.deleteMany({
            userName: session.userName,
            sessionid: { $ne: session.sessionid },
        });
        await Session.updateOne({ sessionid }, {
            shareKey: shareKey,
            shareKeySign: shareKeySign,
            encrypted: true,
        });
        await users.updateOne({ userName: session.userName }, {
            masterKey,
        });
        await accountKeyData.create({
            userName: session.userName,
            hash: await keyHash(accountKey),
            key: accountKey,
            sign: accountKeySign,
        });
        return c.json({ status: "success" });
    },
);

export default app;
