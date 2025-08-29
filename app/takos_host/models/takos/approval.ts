import mongoose from "mongoose";
import { approvalSchema } from "../../../takos/models/takos/approval.ts";
import tenantScope from "../plugins/tenant_scope.ts";

approvalSchema.plugin(tenantScope, { envKey: "ACTIVITYPUB_DOMAIN" });
approvalSchema.index({ groupName: 1, actor: 1, tenant_id: 1 }, { unique: true });

const Approval = mongoose.models.Approval ??
  mongoose.model("Approval", approvalSchema, "approvals");

export default Approval;
export { approvalSchema };
