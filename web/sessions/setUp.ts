import {
  isValidAccountKeyPublic,
  isValidMasterKeyPublic,
  isValidShareKeyPublic,
  keyHash,
  verifyMasterKey,
} from "@takos/takos-encrypt-ink";
import {
  arrayBufferToBase64,
  base64ToArrayBuffer,
} from "https://jsr.io/@takos/takos-encrypt-ink/6.0.2/utils/buffers.ts";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import accountKeyData from "../../models/crypto/accountKey.ts";
import users from "../../models/users/users.ts";
import { resizeImageTo256x256 } from "./utils.ts";
import app from "../../_factory.ts";
import Session from "../../models/users/sessions.ts";

app.post(
  "/setUp",
  zValidator(
    "json",
    z.object({
      masterKey: z.string(),
      accountKey: z.string(),
      accountKeySign: z.string(),
      nickName: z.string().min(1).max(20),
      icon: z.string(),
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
      nickName,
      icon,
      shareKey,
      shareKeySign,
    } = c.req.valid("json");
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
    await Session.updateOne({ sessionid }, {
      shareKey: shareKey,
      shareKeySign: shareKeySign,
      encrypted: true,
    });
    await users.updateOne({ userName: session.userName }, {
      nickName,
      icon: arrayBufferToBase64(
        (await resizeImageTo256x256(
          new Uint8Array(base64ToArrayBuffer(icon)),
        )) as unknown as ArrayBuffer,
      ),
      setup: true,
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
