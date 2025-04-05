import mongoose from "mongoose";

const groupSchema = new mongoose.Schema({
  groupId: { type: String, required: true },
  groupName: { type: String },
  groupDescription: { type: String },
  groupIcon: { type: String },
  owner: { type: String, required: true },
  invites: {
    type: [String],
    default: [],
  },
  ban: {
    type: [String],
    default: [],
  },
  to: {
    type: [String],
    default: [],
  },
  requests: {
    type: [String],
    default: [],
  },
  type: {
    type: String,
    required: true,
    enum: ["public", "private"],
  },
  allowJoin: { type: Boolean },
  beforeEventId: { type: String },
  defaultChannelId: { type: String, required: true },
  isOwner: { type: Boolean, required: true },
  channelOrder: { type: [String], required: true, default: [] },
});

const memberSchema = new mongoose.Schema({
  groupId: { type: String, required: true },
  userId: { type: String, required: true },
  role: { type: [String], required: true },
  joinedAt: { type: Date, default: Date.now },
});

const channelSchema = new mongoose.Schema({
  groupId: { type: String, required: true },
  name: { type: String },
  id: { type: String, required: true },
  category: { type: String },
});

const channelPermissionSchema = new mongoose.Schema({
  groupId: { type: String, required: true },
  channelId: { type: String, required: true },
  roleId: { type: String, required: true },
  permissions: {
    type: [String],
    default: [],
  },
});

const categoryPermissionSchema = new mongoose.Schema({
  groupId: { type: String, required: true },
  categoryId: { type: String, required: true },
  roleId: { type: String, required: true },
  permissions: {
    type: [String],
    default: [],
  },
});

const categorySchema = new mongoose.Schema({
  groupId: { type: String, required: true },
  name: { type: String },
  id: { type: String, required: true },
});

const roleSchema = new mongoose.Schema({
  groupId: { type: String, required: true },
  name: { type: String, required: true },
  id: { type: String, required: true },
  color: { type: String, required: true },
  permissions: {
    type: [String],
    default: [],
  },
});

const joinRequestSchema = new mongoose.Schema({
  groupId: { type: String, required: true },
  userId: { type: String, required: true },
});

const JoinRequest = mongoose.model("joinRequest", joinRequestSchema);

const Roles = mongoose.model("roles", roleSchema);
const Category = mongoose.model("categories", categorySchema);
const Channels = mongoose.model("channels", channelSchema);
const Group = mongoose.model("group", groupSchema);
const ChannelPermissions = mongoose.model(
  "channelPermissions",
  channelPermissionSchema,
);
const CategoryPermissions = mongoose.model(
  "categoryPermissions",
  categoryPermissionSchema,
);
const Member = mongoose.model("member", memberSchema);
export {
  Category,
  CategoryPermissions,
  ChannelPermissions,
  Channels,
  Group,
  JoinRequest,
  Member,
  Roles,
};
