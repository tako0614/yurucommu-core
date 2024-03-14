import mongoose from "mongoose";
const usersSchema = new mongoose.Schema({
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
const users = mongoose.model('users', usersSchema);

export default users;