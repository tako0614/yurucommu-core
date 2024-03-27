import { mongoose } from "mongoose";

export const friendsSchema = new mongoose.Schema({
  user: {
    type: String,
    required: true,
  },
  friends: {
    objects: [
      {
        userName: {
          type: String,
          required: true,
          unique: true,
        },
        room: {
          type: String,
          required: true,
        },
        lastMessage: {
          type: String,
        },
        required: true,
      },
    ],
    type: Array,
    required: true,
    default: [],
  },
  timestamp: { type: Date, default: Date.now },
});
const friends = mongoose.model("friends", friendsSchema);
export default friends;
