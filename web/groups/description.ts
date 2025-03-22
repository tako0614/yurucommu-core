import { Group } from "../../models/groups/groups.ts";
import { Context, Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { load } from "@std/dotenv";
import { uuidv7 } from "npm:uuidv7";
import { fff } from "../../utils/foundationReq.ts";
import { MyEnv } from "../../userInfo.ts";
import { getUserPermission } from "../../utils/getUserPermission.ts";

const env = await load();
const app = new Hono<MyEnv>();

app.post(
    "/",
    zValidator(
        "json",
        z.object({
            groupId: z.string(),
            description: z.string(),
        }),
    ),
    async (c) => {
        const user = c.get("user");
        if (!user) {
            return c.json({ message: "Unauthorized" }, 401);
        }
        const { groupId, description } = c.req.valid("json");
        if (groupId.split("@")[1] === env["domain"]) {
            return await handleDescription({
                groupId,
                description,
                c,
            });
        } else {
            const res = await fff(
                JSON.stringify({
                    event: "t.group.description",
                    eventId: uuidv7(),
                    payload: {
                        groupId,
                        userId: user.userName + "@" + env["domain"],
                        description,
                    },
                }),
                [groupId.split("@")[1]],
            );
            if (Array.isArray(res) ? res[0].status !== 200 : true) {
                return c.json({ message: "Error setting description" }, 500);
            }
            return c.json({ message: "success" });
        }
    },
);

export async function handleDescription({
    groupId,
    description,
    c,
}: {
    groupId: string;
    description: string;
    c: Context;
}) {
    const group = await Group
        .findOne({ groupId });
    if (!group) {
        return c.json({ message: "Invalid groupId" }, 400);
    }
    const permission = await getUserPermission(
        c.get("user").userName + "@" + env["domain"],
        groupId,
    );
    if (!permission) {
        return c.json({ message: "Unauthorized1" }, 401);
    }
    if (!permission.includes(`ADMIN`) && !permission.includes(`MANAGE_GROUP`)) {
        return c.json({ message: "Unauthorized permission" }, 401);
    }
    await Group
        .updateOne({ groupId }, { $set: { description } });
    return c.json({ message: "success" });
}

export default app;
