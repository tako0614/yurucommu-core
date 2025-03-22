import mongoose from "mongoose";

const keyShareDataSchema = new mongoose.Schema({
    userName: {
        type: String,
        required: true,
    },
    sessionid: {
        type: String,
        required: true,
    },
    shareSignKey: {
        type: String,
    },
    sign: {
        type: String,
        required: true,
    },
    timestamp: { type: Date, default: Date.now },
    hash: {
        type: String,
        required: true,
    },
});

const ShareSignKey = mongoose.model("shareSignKey", keyShareDataSchema);

export default ShareSignKey;
