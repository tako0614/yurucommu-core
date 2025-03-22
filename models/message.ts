import mongoose from "mongoose";

const messageSchema = new mongoose.Schema({
    roomId: {
        type: String,
        required: true,
    },
    userName: {
        type: String,
        required: true,
    },
    messageid: {
        type: String,
        required: true,
    },
    isEncrypted: {
        type: Boolean,
    },
    isSigned: {
        type: Boolean,
    },
    message: {
        type: String,
    },
    sign: {
        type: String,
    },
    timestamp: {
        type: Date,
        default: Date.now,
    },
    channelId: {
        type: String,
    },
    isLarge: {
        type: Boolean,
    },
});

const Message = mongoose.model("message", messageSchema);

export default Message;
