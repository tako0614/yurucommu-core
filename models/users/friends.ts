import mongoose from "mongoose";

const friendSchema = new mongoose.Schema({
  userName: {
    type: String,
    required: true,
  },
  friendId: {
    type: String,
    required: true,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
});

export default mongoose.model("Friend", friendSchema);
