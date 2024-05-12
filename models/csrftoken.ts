import mongoose from "mongoose"

export const csrfTokenSchama = new mongoose.Schema({
  token: {
    type: String,
    required: true,
    unique: true,
  },
  sessionID: {
    type: String,
    required: true,
  },
  timestamp: { type: Date, default: Date.now, expires: 60 * 60 * 24 },
})
const csrfToken = mongoose.model("csrfToken", csrfTokenSchama)
export default csrfToken
