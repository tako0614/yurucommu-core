import mongoose from "mongoose";
import { faspClientProviderSchema } from "../../../takos/models/takos/fasp_client_provider.ts";
import tenantScope from "../plugins/tenant_scope.ts";

faspClientProviderSchema.plugin(tenantScope, { envKey: "ACTIVITYPUB_DOMAIN" });
faspClientProviderSchema.index({ baseUrl: 1, tenant_id: 1 }, { unique: true });
faspClientProviderSchema.index({ serverId: 1, tenant_id: 1 }, { unique: true });

const HostFaspClientProvider = mongoose.models.HostFaspClientProvider ??
  mongoose.model("HostFaspClientProvider", faspClientProviderSchema);

export default HostFaspClientProvider;
export { faspClientProviderSchema };