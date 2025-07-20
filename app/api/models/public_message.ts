import mongoose from "mongoose";

const publicMessageSchema = new mongoose.Schema({
  tenant_id: { type: String, index: true },
  from: { type: String, required: true },
  to: { type: [String], required: true },
  content: { type: String, required: true },
  mediaType: { type: String, default: "message/mls" },
  encoding: { type: String, default: "base64" },
  createdAt: { type: Date, default: Date.now },
});

publicMessageSchema.pre("save", function (next) {
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

const PublicMessage = mongoose.models.PublicMessage ??
  mongoose.model("PublicMessage", publicMessageSchema);

export default PublicMessage;
export { publicMessageSchema };
