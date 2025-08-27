import mongoose from "mongoose";
import { notificationSchema } from "../../../takos/models/takos/notification.ts";
import tenantScope from "../plugins/tenant_scope.ts";

notificationSchema.plugin(tenantScope, { envKey: "ACTIVITYPUB_DOMAIN" });

const HostNotification = mongoose.models.HostNotification ??
  mongoose.model("HostNotification", notificationSchema, "notifications");

export default HostNotification;
export { notificationSchema };
