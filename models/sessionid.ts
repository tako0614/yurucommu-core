import mongoose from "mongoose"

export const sessionidSchema = new mongoose.Schema({
  userid: {
    type: mongoose.Schema.ObjectId,
    required: true,
  },
  sessionID: {
    type: String,
    required: true,
    unique: true,
  },
  lastLogin: {
    type: Date,
    required: true,
    default: Date.now,
    expires: 60 * 60 * 24 * 3,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    required: true,
  },
})
const ssessionID = mongoose.model("sessionid", sessionidSchema)
export default ssessionID
