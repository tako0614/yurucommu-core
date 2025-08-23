import mongoose from "mongoose";
import tenantScope from "../plugins/tenant_scope.ts";

const inviteSchema = new mongoose.Schema({
  groupName: { type: String, required: true },
  actor: { type: String, required: true },
  inviter: { type: String, default: "" },
  accepted: { type: Boolean, default: false },
}, { timestamps: true });

inviteSchema.plugin(tenantScope, { envKey: "ACTIVITYPUB_DOMAIN" });
inviteSchema.index({ groupName: 1, actor: 1, tenant_id: 1 }, { unique: true });

const Invite = mongoose.models.Invite ?? mongoose.model("Invite", inviteSchema);

export default Invite;
export { inviteSchema };
