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
});

accountSchema.index({ userName: 1 }, { unique: true });

const Account = mongoose.models.Account ??
  mongoose.model("Account", accountSchema);

export default Account;
export { accountSchema };
