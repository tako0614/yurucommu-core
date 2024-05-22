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
          type: mongoose.Schema.Types.ObjectId,
        },
        room: {
          type: String,
        },
        lastMessage: {
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
