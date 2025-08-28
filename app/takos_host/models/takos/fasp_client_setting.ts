import mongoose from "mongoose";
import { faspClientSettingSchema } from "../../../takos/models/takos/fasp_client_setting.ts";
import tenantScope from "../plugins/tenant_scope.ts";

faspClientSettingSchema.plugin(tenantScope, { envKey: "ACTIVITYPUB_DOMAIN" });
faspClientSettingSchema.index({ _id: 1, tenant_id: 1 }, { unique: true });

const HostFaspClientSetting = mongoose.models.HostFaspClientSetting ??
  mongoose.model("HostFaspClientSetting", faspClientSettingSchema);

export default HostFaspClientSetting;
export { faspClientSettingSchema };