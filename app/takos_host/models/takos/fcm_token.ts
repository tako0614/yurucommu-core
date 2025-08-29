import mongoose from "mongoose";
import tenantScope from "../plugins/tenant_scope.ts";

const fcmTokenSchema = new mongoose.Schema({
  token: { type: String, required: true },
  userName: { type: String, default: "" },
});

fcmTokenSchema.plugin(tenantScope, { envKey: "ACTIVITYPUB_DOMAIN" });
// トークン自体はユニーク定義があるが、テナント付きインデックスも追加
fcmTokenSchema.index({ token: 1, tenant_id: 1 }, { unique: true });

const FcmToken = mongoose.models.FcmToken ??
  mongoose.model("FcmToken", fcmTokenSchema);

export default FcmToken;
export { fcmTokenSchema };

