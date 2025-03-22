import mongoose from "mongoose";

const callRequestSchema = new mongoose.Schema({
    roomId: {
        type: String,
        required: true,
    },
    userId: {
        type: String,
        required: true,
    },
    friendId: {
        type: String,
        required: true,
    },
    callType: {
        type: String,
        required: true,
        enum: ["audio", "video"],
    },
    isEncrypt: {
        type: Boolean,
        default: false,
    },
    roomKeyHash: {
        type: String,
    },
    sessionid: {
        type: String,
        required: true,
    },
    timestamp: {
        type: Date,
        default: Date.now,
        expires: 2
    }
});

export default mongoose.model("CallRequest", callRequestSchema);