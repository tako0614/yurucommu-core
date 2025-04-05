import {
  CategoryPermissions,
  ChannelPermissions,
  Channels,
  Group,
  Member,
  Roles,
} from "../models/groups/groups.ts";

export async function getUserPermission(
  userId: string,
  groupId: string,
  channelId?: string,
) {
  const group = await Group.findOne({ groupId });
  if (!group) {
    throw new Error("Group not found");
  }
  if (group.owner === userId) {
    return [`ADMIN`];
  }
  const user = await Member.findOne({
    groupId: groupId,
    userId: userId,
  });
  if (!user) {
    throw new Error("User not found");
  }
  const roles = await Roles.find({
    groupId: groupId,
    id: { $in: [...user.role, "everyone"] },
  });
  if (!roles) {
    throw new Error("Roles not found");
  }
  const response = [];
  for (const role of roles) {
    const permissions = role.permissions;
    response.push(...permissions);
  }
  if (!channelId) {
    return [...new Set(response)];
  }
  const channelPermissions = await ChannelPermissions.find({
    groupId: groupId,
    channelId: channelId,
    roleId: { $in: ["everyone", ...user.role] },
  });
  if (channelPermissions && channelPermissions.length > 0) {
    for (const cp of channelPermissions) {
      response.push(...cp.permissions);
    }
  }
  const channel = await Channels.findOne({
    groupId: groupId,
    id: channelId,
  });
  if (channel!.category) {
    const categoryPermissions = await CategoryPermissions.find({
      groupId: groupId,
      categoryId: channel!.category,
      roleId: { $in: ["everyone", ...user.role] },
    });
    if (categoryPermissions && categoryPermissions.length > 0) {
      for (const cp of categoryPermissions) {
        response.push(...cp.permissions);
      }
    }
  }
  return [...new Set(response)];
}
export async function getGroupMemberServers(groupId: string) {
  const members = await Member.find({ groupId: groupId });
  const response = members.map((member) => member.userId.split("@")[1]);
  return [...new Set(response)];
}
