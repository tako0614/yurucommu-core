import mongoose from "mongoose";
import { fcmTokenSchema } from "../../../takos/models/takos/fcm_token.ts";
import tenantScope from "../plugins/tenant_scope.ts";

fcmTokenSchema.plugin(tenantScope, { envKey: "ACTIVITYPUB_DOMAIN" });
fcmTokenSchema.index({ token: 1, tenant_id: 1 }, { unique: true });

const HostFcmToken = mongoose.models.HostFcmToken ??
  mongoose.model("HostFcmToken", fcmTokenSchema, "fcmtokens");

export default HostFcmToken;
export { fcmTokenSchema };
