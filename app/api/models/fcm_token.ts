import mongoose from "mongoose";

const fcmTokenSchema = new mongoose.Schema({
  tenant_id: { type: String, index: true },
  token: { type: String, required: true },
  userName: { type: String, default: "" },
});

fcmTokenSchema.index({ tenant_id: 1, token: 1 }, { unique: true });

fcmTokenSchema.pre("save", function (next) {
  const self = this as unknown as {
    $locals?: { env?: Record<string, string> };
    tenant_id?: string;
  };
  const env = self.$locals?.env;
  if (!self.tenant_id && env?.ACTIVITYPUB_DOMAIN) {
    self.tenant_id = env.ACTIVITYPUB_DOMAIN;
  }
  next();
});

const FcmToken = mongoose.models.FcmToken ??
  mongoose.model("FcmToken", fcmTokenSchema);

export default FcmToken;
export { fcmTokenSchema };
