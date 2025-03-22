import mongoose from "mongoose";

const keyShareDataSchema = new mongoose.Schema({
    userName: {
        type: String,
        required: true,
    },
    hash: {
        type: String,
        required: true,
    },
    key: {
        type: String,
        required: true,
    },
    sign: {
        type: String,
        required: true,
    },
    shareDataSign: {
        type: String,
    },
    updateTime: {
        type: Date,
        expires: 60 * 60 * 24 * 14,
    },
    timestamp: {
        type: Date,
        default: Date.now,
    },
});

const accountKeyData = mongoose.model("accountKey", keyShareDataSchema);

export default accountKeyData;
