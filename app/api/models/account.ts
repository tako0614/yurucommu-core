import mongoose from "mongoose";

const accountSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
  },
  displayName: {
    type: String,
    required: true,
  },
  icon: {
    type: String,
    required: true,
  },
  activityPubActor: {
    type: Object,
    required: true,
  },
  publicKeyPem: {
    type: String,
    required: true,
  },
  privateKeyPem: {
    type: String,
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

export const Account = mongoose.model("Account", accountSchema);
