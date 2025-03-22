import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import shareAccountKey from "../../models/crypto/shareAccountKey.ts";
import { Member } from "../../models/groups/groups.ts";
import users from "../../models/users/users.ts";
import app from "../../_factory.ts";
import { getLatestFriendMessageId, getLatestGroupMessageId } from "./utils.ts";
import Session from "../../models/users/sessions.ts";
import { load } from "https://jsr.io/@std/dotenv/0.225.3/mod.ts";
import Friends from "../../models/users/friends.ts";
import request from "../../models/request.ts";
const env = await load();

app.get(
    "/status",
    zValidator(
        "cookie",
        z.object({
            sessionid: z.string().optional(),
        }),
    ),
    async (c) => {
        const sessionid = c.req.valid("cookie").sessionid;
        const session = await Session.findOne({ sessionid });
        if (!session) {
            console.log("Invalid session");
            return c.json({
                login: false,
                setup: false,
                deviceKey: null,
            });
        }
        const userInfo = await users.findOne({ userName: session.userName });
        if (!userInfo || !userInfo.setup || !userInfo.masterKey) {
            return c.json({
                login: true,
                setup: false,
                deviceKey: session.deviceKey,
            });
        }
        const requests = await request.find({
            receiver: userInfo.userName + "@" + env["domain"],
        }).sort({ timestamp: -1 }).limit(100);
        const friends = await Friends.find({
            userName: userInfo.userName + "@" + env["domain"],
        });
        const friendList = friends.map((f) => f.friendId);

        const groups = await Member.find({
            userId: userInfo.userName + "@" + env["domain"],
        });

        const groupList = groups.map((g) => g.groupId);
        const groupListSet = new Set(groupList);
        const groupListUnique = Array.from(groupListSet);

        const groupInfo = await Promise.all(groupListUnique.map(async (g) => {
            const latestMessageId = await getLatestGroupMessageId(g);
            return [g, latestMessageId];
        }));

        const friendInfo = await Promise.all(friendList.map(async (f) => {
            console.log(f);
            // friendIdは "username@domain" の形式と仮定
            const [friendUser, friendDomain] = f.split("@");
            const latestMessageId = await getLatestFriendMessageId(
                userInfo.userName,
                env["domain"],
                friendUser,
                friendDomain,
                f,
            );
            return [f, latestMessageId];
        }));
        const shareKeys = await shareAccountKey.find({
            userName: userInfo.userName,
            sessionid: session.sessionid,
        });
        const shareKey = shareKeys.map((s) => s.hash);
        return c.json({
            login: true,
            setup: true,
            encrypted: session.encrypted,
            deviceKey: session.deviceKey,
            requests: requests.map((r) => ({
                id: r.id,
                type: r.type,
                sender: r.sender,
                query: r.query,
                timestamp: r.timestamp,
            })),
            friendInfo,
            groupInfo,
            updatedAccountKeys: shareKey,
        });
    },
);

export default app;
