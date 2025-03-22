import { Hono } from "hono";
import { MyEnv } from "../../userInfo.ts";
import friends from "../../models/users/friends.ts";
import { env } from "./common.ts";

const app = new Hono<MyEnv>();

app.get("/", async (c) => {
    const user = c.get("user");
    const befor = c.req.query("befor");
    if (!user) {
        return c.json({ message: "Unauthorized" }, 401);
    }
    let friendsList;
    if (befor) {
        friendsList = await friends.find({
            userName: user.userName + "@" + env["domain"],
            timestamp: { $lt: new Date(befor) },
        }).sort({ timestamp: -1 }).limit(10);
    } else {
        friendsList = await friends.find({
            userName: user.userName + "@" + env["domain"],
        }).limit(10);
    }
    return c.json(friendsList.map((friend) => friend.friendId));
});

export default app;
