import mongoose from "mongoose";
import tenantScope from "../plugins/tenant_scope.ts";

const notificationSchema = new mongoose.Schema({
  title: { type: String, required: true },
  message: { type: String, required: true },
  type: { type: String, default: "info" },
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

notificationSchema.plugin(tenantScope, { envKey: "ACTIVITYPUB_DOMAIN" });

const Notification = mongoose.models.Notification ??
  mongoose.model("Notification", notificationSchema);

export default Notification;
export { notificationSchema };
