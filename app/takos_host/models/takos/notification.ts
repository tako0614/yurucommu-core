import mongoose from "mongoose";
import { notificationSchema } from "../../../takos/models/takos/notification.ts";
import tenantScope from "../plugins/tenant_scope.ts";

notificationSchema.plugin(tenantScope, { envKey: "ACTIVITYPUB_DOMAIN" });

const Notification = mongoose.models.Notification ??
  mongoose.model("Notification", notificationSchema);

export default Notification;
export { notificationSchema };

