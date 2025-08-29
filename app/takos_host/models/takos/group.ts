import mongoose from "mongoose";
import { groupSchema } from "../../../takos/models/takos/group.ts";
import tenantScope from "../plugins/tenant_scope.ts";

// テナントスコープを付与し、グループ名のユニークをテナント込みに変更
groupSchema.plugin(tenantScope, { envKey: "ACTIVITYPUB_DOMAIN" });
groupSchema.index({ groupName: 1, tenant_id: 1 }, { unique: true });

const Group = mongoose.models.Group ??
  mongoose.model("Group", groupSchema);

export default Group;
export { groupSchema };

