import mongoose from "npm:mongoose@^6.7";

export const tempUsersSchema = new mongoose.Schema({
    mail: {
        type: String,
        required: true,
        unique: true,
    },
    key: {
        type: String,
        required: true,
        unique: true
    },
    timestamp: true
})
