import mongoose from "mongoose";

const friendCallRequestSchema = new mongoose.Schema({
  roomId: {
    type: String,
    required: true,
  },
  userId: {
    type: String,
    required: true,
  },
  friendId: {
    type: String,
    required: true,
  },
  callType: {
    type: String,
    required: true,
    enum: ["audio", "video"],
  },
  isEncrypt: {
    type: Boolean,
    default: false,
  },
  roomKeyHash: {
    type: String,
  },
  sessionid: {
    type: String,
  },
  timestamp: {
    type: Date,
    default: Date.now,
    expires: "2m",
  },
});

export default mongoose.model("FriendCallRequest", friendCallRequestSchema);
