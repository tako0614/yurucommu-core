import mongoose from "mongoose";

export const tempUsersSchema = new mongoose.Schema({
    mail: {
        type: String,
        required: true,
        unique: true,
        validate: {
            validator: function(v) {
                return /^[\w-]+@[\w-]+\.[a-z]{2,3}$/.test(v);
            },
            message: props => `${props.value} is not a valid mail address!`
        }
    },
    key: {
        type: String,
        required: true,
        unique: true,
    },
    checkCode: {
        type: Number,
        required: true,
        min: 0,
        max: 4294967295
    },
    checked: {
        type: Boolean,
        default: false
    },
    timestamp: { type: Date, default: Date.now }
})
const tempUsers = mongoose.model('tempUsers', tempUsersSchema);
export default tempUsers;