import mongoose from "mongoose";
import { systemKeySchema } from "../../../takos/models/takos/system_key.ts";
import tenantScope from "../plugins/tenant_scope.ts";

systemKeySchema.plugin(tenantScope, { envKey: "ACTIVITYPUB_DOMAIN" });

const SystemKey = mongoose.models.SystemKey ??
  mongoose.model("SystemKey", systemKeySchema, "system_key");

export default SystemKey;
export { systemKeySchema };

