import mongoose from "mongoose";
import { fcmTokenSchema } from "../../../takos/models/takos/fcm_token.ts";
import tenantScope from "../plugins/tenant_scope.ts";

fcmTokenSchema.plugin(tenantScope, { envKey: "ACTIVITYPUB_DOMAIN" });
// トークン自体はユニーク定義があるが、テナント付きインデックスも追加
fcmTokenSchema.index({ token: 1, tenant_id: 1 }, { unique: true });

const FcmToken = mongoose.models.FcmToken ??
  mongoose.model("FcmToken", fcmTokenSchema);

export default FcmToken;
export { fcmTokenSchema };

