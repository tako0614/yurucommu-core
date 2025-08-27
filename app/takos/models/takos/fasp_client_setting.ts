import mongoose from "mongoose";

const faspClientSettingSchema = new mongoose.Schema({
  _id: { type: String, default: "default" },
  searchServerId: { type: String, default: null },
  shareEnabled: { type: Boolean, default: true },
  shareServerIds: { type: [String], default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, { collection: "fasp_client_settings" });

faspClientSettingSchema.pre("save", function (next) {
  (this as unknown as { updatedAt?: Date }).updatedAt = new Date();
  next();
});

const FaspClientSetting = mongoose.models.FaspClientSetting ??
  mongoose.model("FaspClientSetting", faspClientSettingSchema);

export default FaspClientSetting;
export { faspClientSettingSchema };
