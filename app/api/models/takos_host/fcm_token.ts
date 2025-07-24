import mongoose from "mongoose";

const hostFcmTokenSchema = new mongoose.Schema({
  token: { type: String, required: true },
  userName: { type: String, default: "" },
  tenant_id: { type: String, index: true },
});

hostFcmTokenSchema.index({ token: 1, tenant_id: 1 }, { unique: true });

const HostFcmToken = mongoose.models.HostFcmToken ??
  mongoose.model("HostFcmToken", hostFcmTokenSchema);

export default HostFcmToken;
export { hostFcmTokenSchema };
