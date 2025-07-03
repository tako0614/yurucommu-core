import mongoose from "mongoose";

const accountSchema = new mongoose.Schema({
  userName: { type: String, required: true, unique: true },
  displayName: { type: String, default: "" },
  avatarInitial: { type: String, default: "" },
  privateKey: { type: String, default: "" },
  publicKey: { type: String, default: "" },
  followers: { type: [String], default: [] },
  following: { type: [String], default: [] },
});

const Account = mongoose.model("Account", accountSchema);

export default Account;
export { accountSchema };
