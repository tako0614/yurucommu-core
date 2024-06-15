import mongoose from "mongoose"

export const friendsSchema = new mongoose.Schema({
    serverDomain: {
        type: String,
        required: true,
    },
    friends: {
        type: [
            {
                userid: {
                    type: String,
                },
                type: {
                    type: String,
                    enum: ["local", "other"],
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
const friends = mongoose.model("remoteservers", friendsSchema)
export default friends
