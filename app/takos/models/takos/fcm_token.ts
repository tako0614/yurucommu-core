import mongoose from "mongoose";

const fcmTokenSchema = new mongoose.Schema({
  token: { type: String, required: true },
  userName: { type: String, default: "" },
});

fcmTokenSchema.index({ token: 1 }, { unique: true });

const FcmToken = mongoose.models.FcmToken ??
  mongoose.model("FcmToken", fcmTokenSchema);

export default FcmToken;
export { fcmTokenSchema };
