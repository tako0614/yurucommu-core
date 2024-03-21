import { mongoose } from "mongoose";

export const roomsSchema = new mongoose.Schema({
    room: {
        type: String,
        required: true
    },
    users: {
        type: Array,
        required: true,
        default: []
    },
    timestamp: { type: Date, default: Date.now }
})
const rooms = mongoose.model('rooms', roomsSchema);