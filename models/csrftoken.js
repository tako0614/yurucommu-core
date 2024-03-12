import mongoose from "npm:mongoose@^6.7";

export const csrfTokenSchama = new mongoose.Schema({
    token: {
        type: String,
        required: true,
        unique: true
    },
    timestamp: true
})
