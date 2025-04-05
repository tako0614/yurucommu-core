import mongoose from "mongoose";

const keyShareDataSchema = new mongoose.Schema({
  userName: {
    type: String,
    required: true,
  },
  hash: {
    type: String,
    required: true,
  },
  encryptedAccountKey: {
    type: String,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
  sessionid: {
    type: String,
  },
  sign: {
    type: String,
  },
  updateTime: {
    type: Date,
    expires: 60 * 60 * 24 * 14,
  },
});

const KeyShareData = mongoose.model("accountKeyShare", keyShareDataSchema);

export default KeyShareData;
