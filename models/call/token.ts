import mongoose, { Document } from "mongoose";

const callTokenSchema = new mongoose.Schema({
    token: {
        type: String,
        required: true,
    },
    roomId: {
        type: String,
        required: true,
    },
    userId: {
        type: String,
        required: true,
    },
    callType: {
        type: String,
        required: true,
        enum: ["audio", "video", "text"], // added "text" to support text calls
    },
    type: {
        type: String,
        enum: ["friend", "group"],
    }
});

export interface callToken extends Document {
    token: string;
    roomId: string;
    userId: string;
    callType: string;
}

export const CallToken = mongoose.model("CallToken", callTokenSchema);
