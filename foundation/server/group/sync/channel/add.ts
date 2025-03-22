import { z } from "zod";
import {
    ChannelPermissions,
    Channels,
    Group,
} from "../../../../../models/groups/groups.ts";
import { handleReCreateGroup } from "../../../../../web/groups/utils.ts";
import { eventManager } from "../../../eventManager.ts";
import { load } from "@std/dotenv";
const env = await load();

eventManager.add(
    "t.group.sync.channel.add",
    z.object({
        groupId: z.string(),
        channelId: z.string(),
        category: z.string().optional(),
        permissions: z.array(z.object({
            roleId: z.string(),
            permissions: z.array(z.string()),
        })).optional(),
        beforeEventId: z.string(),
    }),
    async (c, payload) => {
        const domain = c.get("domain");
        const eventId = c.get("eventId");
        const { groupId, channelId, category, permissions } = payload;
        if (groupId.split("@")[1] === env["domain"]) {
            return c.json({ error: "Invalid groupId" }, 400);
        }
        if (domain !== groupId.split("@")[1]) {
            return c.json({ error: "Invalid groupId1" }, 400);
        }
        const group = await Group.findOne({
            groupId: groupId,
        });
        if (!group) {
            return c.json({ error: "Invalid groupId2" }, 400);
        }
        const channel = await Channels.findOne({
            groupId: groupId,
            id: channelId,
        });
        if (group.beforeEventId !== payload.beforeEventId) {
            console.log("recreate");
            await handleReCreateGroup(groupId, eventId);
            return c.json(200);
        }
        if (channel) {
            // 既存のチャンネルの場合は上書き更新
            await Channels.updateOne(
                { groupId: groupId, id: channelId },
                { category: category },
            );
            // 既存の権限を削除し、新たに設定
            await ChannelPermissions.deleteMany({
                groupId: groupId,
                channelId: channelId,
            });
            for (const permission of permissions ?? []) {
                await ChannelPermissions.create({
                    groupId: groupId,
                    channelId: channelId,
                    roleId: permission.roleId,
                    permissions: permission.permissions,
                });
            }
        } else {
            // チャンネルが存在しない場合は新規作成
            await Channels.create({
                groupId: groupId,
                id: channelId,
                category: category,
            });
            for (const permission of permissions ?? []) {
                await ChannelPermissions.create({
                    groupId: groupId,
                    channelId: channelId,
                    roleId: permission.roleId,
                    permissions: permission.permissions,
                });
            }
        }
        await Group.updateOne({ groupId }, { beforeEventId: eventId });
        return c.json(200);
    },
);
