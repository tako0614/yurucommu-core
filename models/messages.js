import mongoose from "mongoose";

export const messagesSchema = new mongoose.Schema({
  sender: {
    type: String,
    required: true,
  },
  room: {
    type: String,
    required: true,
  },
  message: {
    type: String,
    required: true,
  },
  timestamp: { type: Date, default: Date.now },
});
const messages = mongoose.model("messages", messagesSchema);
export default messages;
