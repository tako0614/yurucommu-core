import mongoose from "mongoose"

export const friendsSchema = new mongoose.Schema({
  user: {
    type: String,
    required: true,
  },
  friends: {
    type: [
      {
        userid: {
          type: String,
        },
        room: {
          type: String,
        },
        lastMessage: {
          type: String,
        },
        type: {
          type: String,
          enum: ["local", "other"],
        },
        userName: {
          type: String,
        },
        host: {
          type: String,
        },
      },
    ],
    default: [],
  },
  timestamp: { type: Date, default: Date.now },
})
const friends = mongoose.model("friends", friendsSchema)
export default friends
