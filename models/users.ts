import mongoose from "mongoose"
const usersSchema = new mongoose.Schema({
    uuid: {
        type: String,
        required: true,
        unique: true,
    },
    userName: {
        type: String,
        required: true,
        unique: true,
        validate: {
            validator: function (v: string) {
                return /^[a-zA-Z0-9-_]{4,16}$/.test(v)
            },
            message: (props: { value: any }) => `${props.value} is not a valid username!`,
        },
    },
    password: {
        type: String,
        required: true,
        validate: {
            validator: function (v: string) {
                return /^(?=.*?[a-z])(?=.*?\d)[a-z\d]{8,}$/i.test(v)
            },
            message: (props: { value: any }) => `${props.value} is not a valid password!`,
        },
    },
    mail: {
        type: String,
        required: true,
        unique: true,
        validate: {
            validator: function (v: string) {
                return /^[\w-]+@[\w-]+\.[a-z]{2,3}$/.test(v)
            },
            message: (props: { value: any }) => `${props.value} is not a valid mail address!`,
        },
    },
    salt: {
        type: String,
        required: true,
    },
    age: {
        type: Number,
        required: true,
        rating: { type: Number, required: true, min: 1, max: 120 },
        min: 1,
        max: 120,
    },
    nickName: {
        type: String,
        required: true,
        validate: {
            validator: function (v: string) {
                return /^[ぁ-んァ-ン一-龥a-zA-Z0-9]{1,20}$/.test(v)
            },
            message: (props: { value: any }) => `${props.value} is not a valid mail address!`,
        },
    },
    JoiningRoom: {
        type: [{
            uuid: {
                type: String,
            },
            name: {
                type: String,
            },
        }],
        default: [],
    },
    addFriendKey: {
        type: String,
    },
    config: {
        type: {
            theme: {
                type: String,
                enum: ["light", "dark"],
                default: "light",
            },
            language: {
                type: String,
                enum: ["ja", "en"],
                default: "ja",
            },
            notification: {
                type: Boolean,
                default: true,
            },
            //外部サーバーのユーザーを許可するかどうか
            allowOtherUser: {
                type: Boolean,
                default: true,
            },
            //idによる友達追加を許可するかどうか
            allowAddFriendByID: {
                type: Boolean,
                default: true,
            },
            //
        },
    },
    timestamp: { type: Date, default: Date.now },
})
const users = mongoose.model("users", usersSchema)
export default users
