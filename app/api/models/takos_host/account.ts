import mongoose from "mongoose";

const accountSchema = new mongoose.Schema({
  userName: { type: String, required: true },
  displayName: { type: String, default: "" },
  avatarInitial: { type: String, default: "" },
  privateKey: { type: String, default: "" },
  publicKey: { type: String, default: "" },
  followers: { type: [String], default: [] },
  following: { type: [String], default: [] },
  tenant_id: { type: String, index: true },
});

accountSchema.index({ userName: 1, tenant_id: 1 }, { unique: true });

const HostAccount = mongoose.models.HostAccount ??
  mongoose.model("HostAccount", accountSchema, "accounts");

export default HostAccount;
export { accountSchema };
