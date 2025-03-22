import { createBaseApp, env } from "./base.ts";
import User from "../../models/users/users.ts";

const app = createBaseApp();

app.get("/user/:key/:userId", async (c) => {
    const key = c.req.param("key");
    const userId = c.req.param("userId");
    if (!key || !userId) {
        return c.json({ error: "Invalid request" }, 400);
    }
    const userName = userId.split("@")[0];
    if (userId.split("@")[1] !== env["domain"]) {
        return c.json({ error: "Invalid userId" }, 400);
    }
    const user = await User.findOne({ userName });
    if (!user) {
        return c.json({ error: "Invalid userId" }, 400);
    }
    switch (key) {
        case "icon": {
            return c.json({ icon: user.icon });
        }
        case "nickName": {
            return c.json({ nickName: user.nickName });
        }
        case "description": {
            return c.json({ description: user.description });
        }
    }
    return c.json({ error: "Invalid request" }, 400);
});

export default app;
