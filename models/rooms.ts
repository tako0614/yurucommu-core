import mongoose from "mongoose"
export const roomsSchema = new mongoose.Schema({
    uuid: {
        type: String,
        required: true,
    },
    showName: {
        type: String,
        default: "",
    },
    types: {
        type: String,
        required: true,
        enum: ["group", "friend", "public", "remotefriend"],
    },
    users: {
        type: [
            {
                userid: {
                    type: String,
                },
                type: {
                    type: String,
                    enum: ["local", "other"],
                },
                readedMessageCount: {
                    type: Number,
                    default: 0,
                },
            },
        ],
        required: true,
        default: [],
    },
    messageCount: {
        type: Number,
        default: 0,
    },
    latestmessage: {
        type: String,
        default: "",
    },
    latestMessageTime: {
        type: Date,
        required: true,
        default: Date.now,
    },
    timestamp: { type: Date, default: Date.now },
})
const rooms = mongoose.model("rooms", roomsSchema)
export default rooms
