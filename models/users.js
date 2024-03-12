import mongoose from "npm:mongoose@^6.7";
export const usersSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        unique: true
    },
    password: {
        type: String,
        uniqued: true
    },
    mail: {
        type: String,
        required: true,
        unique: true,
    },
    salt: {
        type: String,
        required: true
    },
    uuid: {
        type: String,
        required: true
    },
    timestamp: true
})