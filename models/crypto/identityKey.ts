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
  identityKey: {
    type: String,
    required: true,
  },
  sign: {
    type: String,
    required: true,
  },
  sessionid: {
    type: String,
    required: true,
  },
  updateTime: {
    type: Date,
    expires: 60 * 60 * 24 * 14,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
});

const KeyShareData = mongoose.model("identityKey", keyShareDataSchema);

export default KeyShareData;
