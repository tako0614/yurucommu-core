import mongoose from "mongoose"

export const csrfTokenSchama = new mongoose.Schema({
    token: {
        type: String,
        required: true,
        unique: true,
    },
    origin: {
        type: String,
        required: true,
    },
    timestamp: { type: Date, default: Date.now, expires: 60 * 2 },
})
const takostoken = mongoose.model("takostoken", csrfTokenSchama)
export default takostoken
