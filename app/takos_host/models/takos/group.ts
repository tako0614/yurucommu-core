import mongoose from "mongoose";
import { groupSchema } from "../../../takos/models/takos/group.ts";
import tenantScope from "../plugins/tenant_scope.ts";

groupSchema.plugin(tenantScope, { envKey: "ACTIVITYPUB_DOMAIN" });
groupSchema.index({ groupName: 1, tenant_id: 1 }, { unique: true });

const HostGroup = mongoose.models.HostGroup ??
  mongoose.model("HostGroup", groupSchema, "groups");

export default HostGroup;
export { groupSchema };