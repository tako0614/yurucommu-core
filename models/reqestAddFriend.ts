import mongoose from "mongoose"
export const requestAddFriendSchema = new mongoose.Schema({
    userID: {
        type: String,
        required: true,
    },
    Applicant: {
        type: [{
            userID: {
                type: String,
                required: true,
            },
            userName: {
                type: String,
                required: true,
            },
            host: {
                type: String,
                required: true,
            },
            type: {
                type: String,
                required: true,
                enum: ["local", "other"],
            },
            timestamp: { type: Date, default: Date.now },
        }],
        default: [],
    },
    //自分が申請したユーザー
    AppliedUser: {
        type: [{
            userID: {
                type: String,
                required: true,
            },
            userName: {
                type: String,
                required: true,
            },
            host: {
                type: String,
                required: true,
            },
            type: {
                type: String,
                required: true,
                enum: ["local", "other"],
            },
            timestamp: { type: Date, default: Date.now },
        }],
        default: [],
    },
    checked: {
        type: Boolean,
        required: true,
        default: false,
    },
    timestamp: { type: Date, default: Date.now },
})
const requestAddFriend = mongoose.model(
    "requestAddFriend",
    requestAddFriendSchema,
)
export default requestAddFriend
