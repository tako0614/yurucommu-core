import mongoose from "mongoose";
const usersSchema = new mongoose.Schema({
    userName: {
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
    age: {
        type: Number,
        required: true
    },
    timestamp: { type: Date, default: Date.now }
})
const users = mongoose.model('users', usersSchema);
export default users;