import mongoose from "mongoose";
import tenantScope from "../plugins/tenant_scope.ts";

const groupSchema = new mongoose.Schema({
  groupName: { type: String, required: true },
  displayName: { type: String, default: "" },
  summary: { type: String, default: "" },
  icon: { type: mongoose.Schema.Types.Mixed, default: null },
  image: { type: mongoose.Schema.Types.Mixed, default: null },
  privateKey: { type: String, default: "" },
  publicKey: { type: String, default: "" },
  membershipPolicy: { type: String, default: "open" },
  invitePolicy: { type: String, default: "members" },
  visibility: { type: String, default: "public" },
  allowInvites: { type: Boolean, default: true },
  followers: { type: [String], default: [] },
  outbox: { type: [mongoose.Schema.Types.Mixed], default: [] },
});

// テナントスコープを付与し、グループ名のユニークをテナント込みに変更
groupSchema.plugin(tenantScope, { envKey: "ACTIVITYPUB_DOMAIN" });
groupSchema.index({ groupName: 1, tenant_id: 1 }, { unique: true });

const Group = mongoose.models.Group ??
  mongoose.model("Group", groupSchema);

export default Group;
export { groupSchema };

