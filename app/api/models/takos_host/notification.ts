import mongoose from "mongoose";
import { notificationSchema } from "../takos/notification.ts";

const HostNotification = mongoose.models.HostNotification ??
  mongoose.model("HostNotification", notificationSchema, "notifications");

export default HostNotification;
export { notificationSchema };
