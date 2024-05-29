import mongoose from "mongoose"

export const csrfTokenSchama = new mongoose.Schema({
  token: {
    type: String,
    required: true,
    unique: true,
  },
  timestamp: { type: Date, default: Date.now, expires: 60 },
})
const csrfToken = mongoose.model("csrfToken", csrfTokenSchama)
export default csrfToken
