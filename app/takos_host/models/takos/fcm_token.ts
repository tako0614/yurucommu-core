import mongoose from "mongoose";
import { fcmTokenSchema } from "../../../takos/models/takos/fcm_token.ts";

const HostFcmToken = mongoose.models.HostFcmToken ??
  mongoose.model("HostFcmToken", fcmTokenSchema, "fcmtokens");

export default HostFcmToken;
export { fcmTokenSchema };
