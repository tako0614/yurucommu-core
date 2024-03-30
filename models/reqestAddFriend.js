import { mongoose } from "mongoose";
export const requestAddFriendSchema = new mongoose.Schema({
  userName: {
    type: String,
    required: true,
  },
  Applicant: [{
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
const requestAddFriend = mongoose.model(
  "requestAddFriend",
  requestAddFriendSchema,
);
export default requestAddFriend;
