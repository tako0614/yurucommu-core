import {
  Category,
  CategoryPermissions,
  ChannelPermissions,
  Channels,
  Group,
  Member,
  Roles,
} from "../../models/groups/groups.ts";
import { load } from "@std/dotenv";
const env = await load();

/**
 * リモートグループのデータを新規作成する
 */
export async function createRemoteGroup(
  groupId: string,
  // deno-lint-ignore no-explicit-any
  resJson: any,
  allowLocalUsers: string[],
  eventId?: string,
) {
  await Group.create({
    groupId,
    type: resJson.type,
    owner: resJson.owner,
    isOwner: false,
    defaultChannelId: resJson.defaultChannel,
    channelOrder: resJson.order,
    order: resJson.order,
    beforeEventId: eventId || resJson.beforeEventId,
  });
  for (const channel of resJson.channels.channels) {
    console.log(channel);
    await Channels.create({
      id: channel.id,
      name: channel.name,
      groupId,
      order: channel.order,
      category: channel.category,
    });
    console.log("channel.permissions", channel.permissions);
    for (const permission of channel.permissions) {
      await ChannelPermissions.create({
        groupId,
        channelId: channel.id,
        roleId: permission.roleId,
        permissions: permission.permissions,
      });
    }
  }
  for (const category of resJson.channels.categories) {
    await Category.create({
      id: category.id,
      name: category.name,
      groupId,
    });
    for (const permission of category.permissions) {
      await CategoryPermissions.create({
        groupId,
        categoryId: category.id,
        roleId: permission.roleId,
        permissions: permission.permissions,
      });
    }
  }
  for (const role of resJson.roles) {
    await Roles.create({
      groupId,
      id: role.id,
      name: role.name,
      color: role.color,
      permissions: role.permission,
    });
  }
  for (const member of resJson.members) {
    if (
      !allowLocalUsers.includes(member.userId) &&
      member.userId.split("@")[1] === env["domain"]
    ) {
      continue;
    }
    await Member.create({
      groupId,
      userId: member.userId,
      role: member.role,
    });
  }
}

export async function handleReCreateGroup(groupId: string, eventId: string) {
  const group = await Group.findOne({ groupId });
  if (!group) {
    return;
  }
  const groupDomain = groupId.split("@")[1];
  if (group.isOwner) {
    return;
  }
  const members = (await Member.find({ groupId })).map((member) => {
    return member.userId;
  }).filter((userId) => userId.split("@")[1] === env["domain"]);
  //groupのデータを削除
  await Group.deleteOne({
    groupId,
  });
  await Channels.deleteMany({
    groupId,
  });
  await ChannelPermissions.deleteMany({
    groupId,
  });
  await Category.deleteMany({
    groupId,
  });
  await CategoryPermissions.deleteMany({
    groupId,
  });
  await Roles.deleteMany({
    groupId,
  });
  await Member.deleteMany({
    groupId,
  });
  //groupのデータを再作成
  await createRemoteGroup(
    groupId,
    await fetch(`https://${groupDomain}/_takos/v1/group/all/${groupId}`).then((
      res,
    ) => res.json()),
    members,
    eventId,
  );
}
