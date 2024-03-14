import mongoose from "mongoose";

export const tempUsersSchema = new mongoose.Schema({
    mail: {
        type: String,
        required: true,
        unique: true,
    },
    key: {
        type: String,
        required: true,
        unique: true,
    },
    timestamp: { type: Date, default: Date.now }
})
const tempUsers = mongoose.model('tempUsers', tempUsersSchema);
export default tempUsers;