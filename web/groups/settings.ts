import { Group } from "../../models/groups/groups.ts";
import { Context, Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { load } from "@std/dotenv";
import { uuidv7 } from "npm:uuidv7";
import { fff } from "../../utils/foundationReq.ts";
import { getUserPermission } from "../../utils/getUserPermission.ts";
import { MyEnv } from "../../userInfo.ts";
import { resizeImageTo256x256 } from "../sessions/utils.ts";
import {
    arrayBufferToBase64,
    base64ToArrayBuffer,
} from "https://jsr.io/@takos/takos-encrypt-ink/5.3.2/utils/buffers.ts";

const env = await load();
const app = new Hono<MyEnv>();

app.post(
    "/",
    zValidator(
        "json",
        z.object({
            groupId: z.string(),
            name: z.string().optional(),
            description: z.string().optional(),
            icon: z.string().optional(),
            allowJoin: z.boolean().optional(),
        }),
    ),
    async (c) => {
        const user = c.get("user");
        if (!user) {
            return c.json({ message: "Unauthorized" }, 401);
        }
        const { groupId, name, description, icon, allowJoin } = c.req.valid(
            "json",
        );
        if (groupId.split("@")[1] === env["domain"]) {
            return await handleSettings({
                groupId,
                name,
                description,
                icon,
                allowJoin,
                c,
                userId: user.userName + "@" + env["domain"],
            });
        } else {
            if (
                !(name !== undefined || icon !== undefined ||
                    description !== undefined || allowJoin !== undefined)
            ) {
                return c.json({ message: "No changes specified" }, 400);
            }
            const res = await fff(
                JSON.stringify({
                    event: "t.group.settings",
                    eventId: uuidv7(),
                    payload: {
                        groupId,
                        userId: user.userName + "@" + env["domain"],
                        name,
                        description,
                        icon,
                        allowJoin,
                    },
                }),
                [groupId.split("@")[1]],
            );
            if (Array.isArray(res) ? res[0].status !== 200 : true) {
                return c.json({ message: "Error changing settings" }, 500);
            }
            return c.json({ message: "success" });
        }
    },
);

export async function handleSettings({
    groupId,
    name,
    description,
    icon,
    allowJoin,
    c,
    userId,
}: {
    groupId: string;
    name: string | undefined;
    description: string | undefined;
    icon: string | undefined;
    allowJoin: boolean | undefined;
    c: Context;
    userId: string;
}) {
    const group = await Group.findOne({ groupId });
    if (!group) {
        return c.json({ message: "Invalid groupId" }, 400);
    }
    const permission = await getUserPermission(
        userId,
        groupId,
    );
    if (
        !(name !== undefined || icon !== undefined ||
            description !== undefined ||
            allowJoin !== undefined)
    ) {
        return c.json({ message: "No changes specified" }, 400);
    }
    if (!permission) {
        return c.json({ message: "Unauthorized1" }, 401);
    }
    if (!permission.includes(`ADMIN`) && !permission.includes(`MANAGE_GROUP`)) {
        return c.json({ message: "Unauthorized permission" }, 401);
    }
    if (name) {
        await Group.updateOne({ groupId }, { $set: { groupName: name } });
    }
    if (icon) {
        const resizedIcon = await resizeImageTo256x256(
            new Uint8Array(base64ToArrayBuffer(icon)),
        );
        const buffer = resizedIcon.buffer;
        await Group.updateOne({ groupId }, {
            $set: { groupIcon: arrayBufferToBase64(buffer as ArrayBuffer) },
        });
    }
    if (allowJoin !== undefined) {
        await Group.updateOne({ groupId }, { $set: { allowJoin } });
    }
    await Group.updateOne({ groupId }, {
        $set: { groupDescription: description },
    });
    return c.json({ message: "success" });
}

export default app;
