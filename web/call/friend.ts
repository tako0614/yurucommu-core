import { fff } from "../../utils/foundationReq.ts";
import publish from "../../utils/redisClient.ts";
import { Hono } from "hono";
import { load } from "@std/dotenv";
import { MyEnv, authorizationMiddleware } from "../../userInfo.ts";
import { zValidator } from "@hono/zod-validator";
import z from "zod";
import callRequest from "../../models/call/request.ts";
import friends from "../../models/users/friends.ts";
const env = await load();
const app = new Hono<MyEnv>();
app.use("*", authorizationMiddleware);

app.post(
    "/audio/request",
    zValidator(
        "json",
        z.object({
            friendId: z.string(),
            roomKeyHash: z.string(),
        }).strict(),
    ),
    async (c) => {
        const user = c.get("user")
        const session = c.get("session")
        if(!user || !session){
            return c.json({ status: "error", message: "Invalid session" }, 400);
        }
        const { friendId, roomKeyHash } = c.req.valid("json");
        const friendHost = friendId.split("@")[1];
        const friendUser = friendId.split("@")[0];
        if(await friends.findOne({userName: user.userName, friendId: friendUser}) === null){
            return c.json({ status: "error", message: "Invalid friend" }, 400);
        }
        if (friendHost !== env["domain"]) {
            return c.json({ status: "error", message: "Invalid friend" }, 400);
        }
        await callRequest.create({
            userId: user.userName + "@" + env["domain"],
            roomId: user.userName + "@" + env["domain"] + "-" + friendId,
            callType: "audio",
            isEncrypt: true,
            friendId: friendId,
            roomKeyHash: roomKeyHash,
            sessionid: session.sessionid,
        });
        publish({
            type: "callRequest",
            users: [friendId],
            data: JSON.stringify({
                userName: user.userName,
            }),
            subPubType: "client",
        });
    },
);

app.post(
    "/audio/accept",
    zValidator(
        "json",
        z.object({
            roomId: z.string(),
        }).strict(),
    ),
    async (c) => {
        const user = c.get("user")
        const session = c.get("session")
        if(!user || !session){
            return c.json({ status: "error", message: "Invalid session" }, 400);
        }
        const { roomId } = c.req.valid("json");
        const call = await callRequest.findOne({roomId: roomId});
        if(call === null){
            return c.json({ status: "error", message: "Invalid call" }, 400);
        }
        if(call.friendId !== user.userName + "@" + env["domain"]){
            return c.json({ status: "error", message: "Invalid call" }, 400);
        }
        
    },
);