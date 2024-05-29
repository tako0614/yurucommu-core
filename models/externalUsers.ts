import mongoose from "mongoose"
const usersSchema = new mongoose.Schema({
  userName: {
    type: String,
    required: true,
    unique: true,
    validate: {
      validator: function (v: string) {
        return /^[a-zA-Z0-9-_]{4,16}$/.test(v)
      },
      message: (props: { value: any }) =>
        `${props.value} is not a valid username!`,
    },
  },
  host: {
    type: String,
    required: true,
  },
  nickName: {
    type: String,
    required: true,
    validate: {
      validator: function (v: string) {
        return /^[ぁ-んァ-ン一-龥a-zA-Z0-9]{1,20}$/.test(v)
      },
      message: (props: { value: any }) =>
        `${props.value} is not a valid mail address!`,
    },
  },
  timestamp: { type: Date, default: Date.now },
})
const users = mongoose.model("users", usersSchema)
export default users
