import { z } from "zod";
import friends from "../../../models/users/friends.ts";
import User from "../../../models/users/users.ts";
import { eventManager } from "../eventManager.ts";
import request from "../../../models/request.ts";
import { load } from "@std/dotenv";
const env = await load();

eventManager.add(
  "t.friend.request",
  z.object({
    userId: z.string().email(),
    friendId: z.string().email(),
  }),
  async (c, payload) => {
    const domain = c.get("domain");
    const { userId, friendId } = payload;
    if (userId.split("@")[1] !== domain) {
      return c.json({ error: "Invalid userId" }, 400);
    }
    if (!await User.findOne({ userName: friendId.split("@")[0] })) {
      return c.json({ error: "Invalid friendId" }, 400);
    }
    if (friendId.split("@")[1] !== env["domain"]) {
      return c.json({ error: "Invalid friendId" }, 400);
    }
    const friend = await friends.findOne({
      userName: friendId,
      friendId: userId,
    });
    console.log(friend, userId, friendId);
    if (friend) {
      return c.json({ error: "Already friends" }, 400);
    }
    const alreadyRequested = await request.findOne({
      sender: userId,
      receiver: friendId,
      type: "friend",
    });
    if (alreadyRequested) {
      return c.json({ message: "Already requested" }, 400);
    }
    await request.create({
      sender: userId,
      receiver: friendId,
      type: "friend",
      local: false,
    });
    return c.json(200);
  },
);
