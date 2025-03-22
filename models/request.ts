import mongoose from "mongoose";
import { uuidv7 } from "npm:uuidv7@^1.0.2";

const requestSchema = new mongoose.Schema({
    sender: {
        type: String,
        required: true,
    },
    receiver: {
        type: String,
        required: true,
    },
    type: {
        type: String,
        required: true,
    },
    query: {
        type: String,
    },
    local: {
        type: Boolean,
        required: true,
    },
    timestamp: {
        type: Date,
        default: Date.now(),
    },
    id: {
        type: String,
        default: uuidv7(),
        required: true,
    },
});

export default mongoose.model("Request", requestSchema);
