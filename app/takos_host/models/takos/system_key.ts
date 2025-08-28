import mongoose from "mongoose";
import { systemKeySchema } from "../../../takos/models/takos/system_key.ts";
import tenantScope from "../plugins/tenant_scope.ts";

systemKeySchema.plugin(tenantScope, { envKey: "ACTIVITYPUB_DOMAIN" });
systemKeySchema.index({ domain: 1, tenant_id: 1 }, { unique: true });

const HostSystemKey = mongoose.models.HostSystemKey ??
  mongoose.model("HostSystemKey", systemKeySchema, "system_key");

export default HostSystemKey;
export { systemKeySchema };