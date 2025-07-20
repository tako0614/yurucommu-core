import mongoose from "mongoose";

const keyPackageSchema = new mongoose.Schema({
  tenant_id: { type: String, index: true },
  userName: { type: String, required: true, index: true },
  content: { type: String, required: true },
  mediaType: { type: String, default: "message/mls" },
  encoding: { type: String, default: "base64" },
  createdAt: { type: Date, default: Date.now },
});

keyPackageSchema.pre("save", function (next) {
  const self = this as unknown as {
    $locals?: { env?: Record<string, string> };
  };
  const env = self.$locals?.env;
  if (!this.tenant_id && env?.ACTIVITYPUB_DOMAIN) {
    this.tenant_id = env.ACTIVITYPUB_DOMAIN;
  }
  next();
});

const KeyPackage = mongoose.model("KeyPackage", keyPackageSchema);

export default KeyPackage;
export { keyPackageSchema };
