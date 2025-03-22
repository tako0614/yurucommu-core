import mongoose from "mongoose";

const keyShareDataSchema = new mongoose.Schema({
    userName: {
        type: String,
        required: true,
    },
    roomId: {
        type: String,
        required: true,
    },
    hash: {
        type: String,
        required: true,
    },
    encrtypedRoomKey: {
        type: Array,
    },
    timestamp: {
        type: Date,
        default: Date.now,
    },
    updateTime: {
        type: Date,
        expires: 60 * 60 * 24 * 14,
    },
    metaData: {
        type: String,
        required: true,
    },
    sign: {
        type: String,
        required: true,
    },
});

const KeyShareData = mongoose.model("roomKey", keyShareDataSchema);

export default KeyShareData;
