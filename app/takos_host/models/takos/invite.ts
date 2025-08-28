import mongoose from "mongoose";
import { inviteSchema } from "../../../takos/models/takos/invite.ts";
import tenantScope from "../plugins/tenant_scope.ts";

inviteSchema.plugin(tenantScope, { envKey: "ACTIVITYPUB_DOMAIN" });
inviteSchema.index({ groupName: 1, actor: 1, tenant_id: 1 }, { unique: true });

const HostInvite = mongoose.models.HostInvite ??
  mongoose.model("HostInvite", inviteSchema, "invites");

export default HostInvite;
export { inviteSchema };