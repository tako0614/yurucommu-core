import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema({
  tenant_id: { type: String, index: true },
  title: { type: String, required: true },
  message: { type: String, required: true },
  type: { type: String, default: "info" },
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

notificationSchema.pre("save", function (next) {
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

const Notification = mongoose.models.Notification ??
  mongoose.model("Notification", notificationSchema);

export default Notification;
export { notificationSchema };
