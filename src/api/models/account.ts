import mongoose from "mongoose";

const accountSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
  },
  icon: {
    type: String,
    required: true,
  },
  activityPubActor: {
    type: Object,
    required: true,
  },
  publicKeyPem: { // 公開鍵
    type: String,
    required: true,
  },
  privateKeyPem: { // 秘密鍵 (取り扱いに注意)
    type: String,
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

export const Account = mongoose.model("Account", accountSchema);
