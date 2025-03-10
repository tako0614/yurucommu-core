import { createBaseApp, env } from "./base.ts";
import User from "../../models/users/users.ts";
import serverKey from "../../models/foundation/serverKeys.ts";
import IdentityKey from "../../models/crypto/identityKey.ts";
import RoomKey from "../../models/crypto/roomKey.ts";
import accountKeyData from "../../models/crypto/accountKey.ts";

const app = createBaseApp();

app.get("/key/:kind", async (c) => {
  const kind = c.req.param("kind");
  console.log("kind", kind);
  if (!kind) {
    return c.json({ error: "Invalid request1" }, 400);
  }
  if (kind === "server") {
    const expire = c.req.query("expire");
    const server = await serverKey.findOne({ expire });
    if (!server) {
      return c.json({ error: "Invalid expire" }, 400);
    }
    return c.json({
      key: server.public,
    });
  }
  const userId = c.req.query("userId");
  if (!userId) {
    return c.json({ error: "Invalid request2" }, 400);
  }
  if (userId.split("@")[1] !== env["domain"]) {
    return c.json({ error: "Invalid userId" }, 400);
  }
  const user = await User.findOne({ userName: userId.split("@")[0] });
  if (!user) {
    return c.json({ error: "Invalid userId" }, 400);
  }
  switch (kind) {
    case "masterKey": {
      return c.json({ key: user.masterKey });
    }
    case "accountKey": {
      const accountKey = await accountKeyData.findOne({
        userName: user.userName,
      }).sort({ timestamp: -1 });
      if (!accountKey) {
        return c.json({ error: "Invalid accountKey" }, 400);
      }
      return c.json({
        key: accountKey.key,
        signature: accountKey.sign,
      });
    }
    case "identityKey": {
      const hash = c.req.query("hash");
      if (!hash) {
        return c.json({ error: "Invalid request3" }, 400);
      }
      const identityKey = await IdentityKey.findOne({
        hash,
        userName: user.userName,
      });
      if (!identityKey) {
        return c.json({ error: "Invalid hash" }, 400);
      }
      return c.json({ key: identityKey.identityKey });
    }
    case "roomKey": {
      const roomid = c.req.query("roomId");
      const targetUserId = c.req.query("targetUserId");
      const hash = c.req.query("hash");
      if (!targetUserId || !hash) {
        return c.json({ error: "Invalid request4" }, 400);
      }
      if (roomid) {
        const roomKey = await RoomKey.findOne({ roomId: roomid, hash });
        if (!roomKey) {
          return c.json({ error: "Invalid roomId" }, 400);
        }
        const requestersKey = roomKey.encrtypedRoomKey.find((key) =>
          key[0] === targetUserId
        );
        if (!requestersKey) {
          return c.json({ message: "Unauthorized" }, 401);
        }
        return c.json({
          roomKey: requestersKey[1],
        });
      } else {
        const roomKey = await RoomKey.findOne({ hash });
        if (!roomKey) {
          return c.json({ error: "Invalid roomId" }, 400);
        }
        const requestersKey = roomKey.encrtypedRoomKey.find((key) =>
          key[0] === targetUserId
        );
        if (!requestersKey) {
          return c.json({ message: "Unauthorized" }, 401);
        }
        return c.json({
          roomKey: requestersKey[1],
        });
      }
    }
  }
  return c.json({ error: "Invalid request5" }, 400);
});

export default app;
