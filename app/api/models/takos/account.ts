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
        icon: { type: String, default: "" },
        userSet: {
          type: {
            name: { type: Boolean, default: false },
            icon: { type: Boolean, default: false },
          },
          default: { name: false, icon: false },
        },
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
