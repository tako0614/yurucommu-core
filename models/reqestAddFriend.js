import { mongoose } from "mongoose";
export const requestAddFriendSchema = new mongoose.Schema({
  user: {
    type: String,
    required: true,
  },
  Applicant: [{
    userid: {
      type: String,
      required: true,
    },
    username: {
      type: String,
      required: true,
    },
    timestamp: { type: Date, default: Date.now },
  }],
  checked: {
    type: Boolean,
    required: true,
    default: false,
  },
  timestamp: { type: Date, default: Date.now },
});
const rooms = mongoose.model("rooms", requestAddFriendSchema);
export default rooms;