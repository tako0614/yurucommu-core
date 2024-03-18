import mongoose from "mongoose";

export const sessionidSchema = new mongoose.Schema({
    userName: {
        type: String,
        required: true,
        validate: {
            validator: function(v) {
                return /^[a-zA-Z0-9-_]{4,16}$/.test(v);
            },
            message: props => `${props.value} is not a valid username!`
        }
    },
    sessionID: {
        type: String,
        required: true,
        unique: true
    },
    lastLogin: {
        type: Date,
        required: true,
        default: Date.now,
        expires: 60 * 60 * 24 * 3,
    },
    createdAt: {
        type: Date,
        default: Date.now,
        requried: true,
    }
})
const ssessionID = mongoose.model('sessionid', sessionidSchema);
export default ssessionID;