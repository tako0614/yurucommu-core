import { createBaseApp, env, escapeRegex } from "./base.ts";
import {
    Category,
    CategoryPermissions,
    ChannelPermissions,
    Channels,
    Group,
    Member,
    Roles,
} from "../../models/groups/groups.ts";

const app = createBaseApp();

app.get("/group/:key/:groupId", async (c) => {
    const key = c.req.param("key");
    const groupId = c.req.param("groupId");
    if (!key || !groupId) {
        return c.json({ error: "Invalid request" }, 400);
    }
    const group = await Group.findOne({ groupId });
    if (!group || group.groupId.split("@")[1] !== env["domain"]) {
        return c.json({ error: "Invalid groupId" }, 400);
    }
    switch (key) {
        case "icon": {
            return c.json({ icon: group.groupIcon });
        }
        case "requests": {
            return c.json({
                requests: group.requests,
            });
        }
        case "bans": {
            return c.json({
                bans: group.ban,
            });
        }
        case "name": {
            return c.json({ name: group.groupName });
        }
        case "description": {
            return c.json({ description: group.groupDescription });
        }
        case "allowJoin": {
            return c.json({ allowJoin: group.allowJoin });
        }
        case "owner": {
            return c.json({ owner: group.owner });
        }
        case "defaultChannel": {
            return c.json({ defaultChannel: group.defaultChannelId });
        }
        case "beforeEventId": {
            return c.json({ beforeEventId: group.beforeEventId });
        }
        case "role": {
            const rolesData = await Roles.find({ groupId });
            const roles = rolesData.map((role) => ({
                id: role.id,
                name: role.name,
                color: role.color,
                permissions: role.permissions,
            }));
            return c.json({ roles });
        }
        case "channels": {
            const categorysRaw = await Category.find({ groupId });
            const categories = await Promise.all(
                categorysRaw.map(async (category) => {
                    const permissionsRaw = await CategoryPermissions.find({
                        groupId,
                        categoryId: category.id,
                    });
                    const permissions = permissionsRaw.map((permission) => ({
                        roleId: permission.roleId,
                        permissions: permission.permissions,
                    }));
                    return {
                        id: category.id,
                        name: category.name,
                        permissions,
                    };
                }),
            );
            const channelsRaw = await Channels.find({ groupId });
            const channels = await Promise.all(
                channelsRaw.map(async (channel) => {
                    const permissionsRaw = await ChannelPermissions.find({
                        groupId,
                        channelId: channel.id,
                    });
                    const permissions = permissionsRaw.map((permission) => ({
                        roleId: permission.roleId,
                        permissions: permission.permissions,
                    }));
                    return {
                        id: channel.id,
                        name: channel.name,
                        category: channel.category,
                        permissions,
                    };
                }),
            );
            return c.json({
                channels: {
                    categories,
                    channels,
                },
            });
        }
        case "members": {
            const members = await Member.find({ groupId });
            return c.json({
                members: members.map((member) => {
                    return {
                        userId: member.userId,
                        role: member.role,
                    };
                }),
            });
        }
        case "order": {
            return c.json({ order: group.channelOrder });
        }
        case "type": {
            return c.json({ type: group.type });
        }
        case "all": {
            const rolesData = await Roles.find({ groupId });
            const roles = rolesData.map((role) => ({
                id: role.id,
                name: role.name,
                color: role.color,
                permissions: role.permissions,
            }));
            const categorysRaw = await Category.find({ groupId });
            const categories = await Promise.all(
                categorysRaw.map(async (category) => {
                    const permissionsRaw = await CategoryPermissions.find({
                        groupId,
                        categoryId: category.id,
                    });
                    const permissions = permissionsRaw.map((permission) => ({
                        roleId: permission.roleId,
                        permissions: permission.permissions,
                    }));
                    return {
                        id: category.id,
                        name: category.name,
                        permissions,
                    };
                }),
            );
            const channelsRaw = await Channels.find({ groupId });
            const channels = await Promise.all(
                channelsRaw.map(async (channel) => {
                    const permissionsRaw = await ChannelPermissions.find({
                        groupId,
                        channelId: channel.id,
                    });
                    const permissions = permissionsRaw.map((permission) => ({
                        roleId: permission.roleId,
                        permissions: permission.permissions,
                    }));
                    return {
                        id: channel.id,
                        name: channel.name,
                        category: channel.category,
                        permissions,
                    };
                }),
            );
            const membersData = await Member.find({ groupId });
            const members = membersData.map((member) => ({
                userId: member.userId,
                role: member.role,
            }));
            return c.json({
                icon: group.groupIcon,
                name: group.groupName,
                description: group.groupDescription,
                owner: group.owner,
                defaultChannel: group.defaultChannelId,
                beforeEventId: group.beforeEventId,
                roles,
                channels: {
                    categories,
                    channels,
                },
                members,
                order: group.channelOrder,
                type: group.type,
            });
        }
    }
    return c.json({ error: "Invalid request" }, 400);
});

app.get("/group/search", async (c) => {
    const query = c.req.query("query");
    const limit = Number(c.req.query("limit")) || 50;
    if (!query) {
        return c.json({ error: "Invalid request" }, 400);
    }
    if (limit > 100) {
        return c.json({ error: "Invalid limit" }, 400);
    }

    const safeQuery = escapeRegex(query);
    const groups = await Group.find({
        $or: [
            { groupName: { $regex: safeQuery, $options: "i" } },
            { groupDescription: { $regex: safeQuery, $options: "i" } },
        ],
        type: "public",
    }).limit(limit);
    if (!groups) {
        return c.json({ error: "No group found" }, 404);
    }
    return c.json({
        groups: await Promise.all(groups.map(async (group) => {
            const members = await Member.find({ groupId: group.groupId });

            return {
                id: group.groupId,
                name: group.groupName,
                icon: group.groupIcon,
                memberCount: members.length,
                allowJoin: group.allowJoin,
            };
        })),
    });
});

export default app;
