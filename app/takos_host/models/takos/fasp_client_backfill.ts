import mongoose from "mongoose";
import { faspClientBackfillSchema } from "../../../takos/models/takos/fasp_client_backfill.ts";
import tenantScope from "../plugins/tenant_scope.ts";

faspClientBackfillSchema.plugin(tenantScope, { envKey: "ACTIVITYPUB_DOMAIN" });

const HostFaspClientBackfill = mongoose.models.HostFaspClientBackfill ??
  mongoose.model("HostFaspClientBackfill", faspClientBackfillSchema);

export default HostFaspClientBackfill;
export { faspClientBackfillSchema };