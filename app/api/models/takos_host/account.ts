import mongoose from "mongoose";

const accountSchema = new mongoose.Schema({
  userName: { type: String, required: true },
  displayName: { type: String, default: "" },
  avatarInitial: { type: String, default: "" },
  privateKey: { type: String, default: "" },
  publicKey: { type: String, default: "" },
  followers: { type: [String], default: [] },
  following: { type: [String], default: [] },
  groups: {
    type: [
      {
        id: String,
        name: String,
        members: [String],
      },
    ],
    default: [],
  },
  tenant_id: { type: String, index: true },
});

accountSchema.index({ userName: 1, tenant_id: 1 }, { unique: true });

const HostAccount = mongoose.models.HostAccount ??
  mongoose.model("HostAccount", accountSchema);

export default HostAccount;
export { accountSchema };
