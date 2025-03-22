import { z } from "zod";
import friends from "../../../../models/users/friends.ts";
import User from "../../../../models/users/users.ts";
import { eventManager } from "../../eventManager.ts";
import request from "../../../../models/request.ts";
import { load } from "@std/dotenv";
import { getActorByHandle } from "../../../../activityPub/logic.ts";
const env = await load();

eventManager.add(
    "t.friend.call.request",
    z.object({
        userId: z.string().email(),
        friendId: z.string().email(),
        roomKeyHash: z.string(),
    }),
    async (c, payload) => {

    },
);
