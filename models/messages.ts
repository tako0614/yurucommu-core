import mongoose from "mongoose"
export const messagesSchema = new mongoose.Schema({
    roomid: {
      type: String,
      required: true,
    },
    messages: [
      {
        sender: {
          type: String,
          required: true, // sender is now required
        },
        message: {
          type: String,
          required: true, // message is now required
        },
        read: [
          {
            userid: {
              type: String,
              required: true, // userid is now required
            },
            readAt: {
              type: Date,
              default: Date.now,
            },
          },
        ],
        timestamp: { type: Date, default: Date.now },
      },
    ],
  })
const messages = mongoose.model("messages", messagesSchema)
export default messages
