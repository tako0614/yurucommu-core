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
            icon: z.string(),
        }),
    ),
    async (c) => {
        const user = c.get("user");
        if (!user) {
            return c.json({ message: "Unauthorized" }, 401);
        }
        const { groupId, icon } = c.req.valid("json");
        const resizedIcon = arrayBufferToBase64(
            (await resizeImageTo256x256(
                new Uint8Array(base64ToArrayBuffer(icon)),
            )) as unknown as ArrayBuffer,
        );
        if (groupId.split("@")[1] === env["domain"]) {
            return await handleIcon({
                groupId,
                icon: resizedIcon,
                c,
                islocal: true,
            });
        } else {
            const res = await fff(
                JSON.stringify({
                    event: "t.group.icon",
                    eventId: uuidv7(),
                    payload: {
                        groupId,
                        userId: user.userName + "@" + env["domain"],
                        icon: resizedIcon,
                    },
                }),
                [groupId.split("@")[1]],
            );
            if (Array.isArray(res) ? res[0].status !== 200 : true) {
                return c.json({ message: "Error setting icon" }, 500);
            }
            return c.json({ message: "success" });
        }
    },
);

export async function handleIcon({
    groupId,
    icon,
    c,
    islocal,
}: {
    groupId: string;
    icon: string;
    c: Context;
    islocal: boolean;
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
    if (islocal) {
        await Group
            .updateOne({ groupId }, { $set: { icon } });
    } else {
        const resizedIcon = arrayBufferToBase64(
            (await resizeImageTo256x256(
                new Uint8Array(base64ToArrayBuffer(icon)),
            )) as unknown as ArrayBuffer,
        );
        await Group
            .updateOne({ groupId }, { $set: { icon: resizedIcon } });
    }
    return c.json({ message: "success" });
}

export default app;
