import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema({
  title: { type: String, required: true },
  message: { type: String, required: true },
  type: { type: String, default: "info" },
  read: { type: Boolean, default: false },
  tenant_id: { type: String, index: true },
  createdAt: { type: Date, default: Date.now },
});

const HostNotification = mongoose.models.HostNotification ??
  mongoose.model("HostNotification", notificationSchema);

export default HostNotification;
export { notificationSchema };
