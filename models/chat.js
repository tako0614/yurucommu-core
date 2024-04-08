import mongoose from "mongoose"

export const chatSchema = new mongoose.Schema({
  room: {
    type: String,
    required: true,
  },
  messages: {
    type: String,
    required: true,
  },
  sender: {
    type: String,
    required: true,
  },
  message: {
    type: String,
    required: true,
  },
  timestamp: { type: Date, default: Date.now },
})
const chat = mongoose.model("chat", chatSchema)
export default chat
