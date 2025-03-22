import { Hono } from "hono";
import { MyEnv } from "../../userInfo.ts";
import { keyHash, verifyMasterKey } from "@takos/takos-encrypt-ink";
import shareAccountKey from "../../models/crypto/shareAccountKey.ts";
import accountKeyData from "../../models/crypto/accountKey.ts";
import Session from "../../models/users/sessions.ts";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

const app = new Hono<MyEnv>();

app.get("/", async (c) => {
    const user = c.get("user");
    if (!user) {
        return c.json({ message: "Unauthorized1" }, 401);
    }
    const accountKeyHash = c.req.query("hash");
    if (!accountKeyHash) {
        return c.json({ message: "Unauthorized2" }, 401);
    }
    const sharedKey = await shareAccountKey.findOne({
        userName: user.userName,
        hash: accountKeyHash,
        sessionid: c.get("session").sessionid,
    });
    if (!sharedKey || !sharedKey.encryptedAccountKey) {
        console.log(user.userName, accountKeyHash, c.get("session").sessionid);
        return c.json({ message: "Unauthorized3" }, 401);
    }
    const accountKey = await accountKeyData.findOne({
        userName: user.userName,
        hash: accountKeyHash,
    });
    if (!accountKey) {
        return c.json({ message: "Unauthorized4" }, 401);
    }
    return c.json({
        accountKey: sharedKey.encryptedAccountKey,
        shareDataSign: accountKey.shareDataSign,
    });
});

app.post(
    "/",
    zValidator(
        "json",
        z.object({
            accountKey: z.string(),
            accountKeySign: z.string(),
            encryptedAccountKeys: z.array(z.tuple([z.string(), z.string()])),
            shareDataSign: z.string(),
        }),
    ),
    async (c) => {
        const user = c.get("user");
        if (!user || !user.masterKey) {
            return c.json({ message: "Unauthorized1" }, 401);
        }
        const { accountKey, accountKeySign, encryptedAccountKeys } = c.req
            .valid(
                "json",
            );
        if (!verifyMasterKey(user.masterKey, accountKeySign, accountKey)) {
            return c.json({ message: "Invalid account key" }, 400);
        }
        const sessionUUIDs = encryptedAccountKeys.map(([sessionUUID]) =>
            sessionUUID
        );
        const serverSessionUUIDs =
            (await Session.find({ userName: user.userName }))
                .map((session) => [session.sessionUUID, session.sessionid]);
        if (
            sessionUUIDs.length !== encryptedAccountKeys.length ||
            !sessionUUIDs.every((sessionUUID) =>
                serverSessionUUIDs.some(([serverSessionUUID]) =>
                    serverSessionUUID === sessionUUID
                )
            )
        ) {
            return c.json({ message: "Invalid session" }, 400);
        }
        const beforAccountKey = await accountKeyData.findOne({
            userName: user.userName,
        }).sort({ timestamp: -1 });
        if (beforAccountKey) {
            await shareAccountKey.updateMany({
                userName: user.userName,
                hash: beforAccountKey.hash,
            }, { $set: { updateTime: new Date() } });
        }
        for (
            const [sessionUUID, encryptedAccountKeyValue]
                of encryptedAccountKeys
        ) {
            await shareAccountKey.create({
                userName: user.userName,
                hash: await keyHash(accountKey),
                encryptedAccountKey: encryptedAccountKeyValue,
                sessionid: serverSessionUUIDs.find(([serverSessionUUID]) =>
                    serverSessionUUID === sessionUUID
                )?.[1] ?? null,
            });
        }
        console.log(accountKey);
        await accountKeyData.create({
            userName: user.userName,
            hash: await keyHash(accountKey),
            key: accountKey,
            sign: accountKeySign,
            shareDataSign: c.req.valid("json").shareDataSign,
        });
        return c.json({ message: "success" });
    },
);

app.post(
    "/notify",
    zValidator(
        "json",
        z.object({
            hash: z.string(),
        }),
    ),
    async (c) => {
        const user = c.get("user");
        if (!user) {
            return c.json({ message: "Unauthorized" }, 401);
        }
        const { hash } = c.req.valid("json");
        const accountKey = await shareAccountKey.findOne({
            userName: user.userName,
            hash,
            sessionid: c.get("session").sessionid,
        });
        if (!accountKey) {
            return c.json({ message: "Unauthorized" }, 401);
        }
        await shareAccountKey.deleteOne({ userName: user.userName, hash });
        return c.json({ message: "success" });
    },
);

export default app;
