import mongoose from "mongoose";
import { accountSchema } from "../../../takos/models/takos/account.ts";
import tenantScope from "../plugins/tenant_scope.ts";

accountSchema.plugin(tenantScope, { envKey: "ACTIVITYPUB_DOMAIN" });
accountSchema.index({ userName: 1, tenant_id: 1 }, { unique: true });

const HostAccount = mongoose.models.HostAccount ??
  mongoose.model("HostAccount", accountSchema, "accounts");

export default HostAccount;
export { accountSchema };
