import mongoose from "mongoose"
export const roomsSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    validate: {
      validator: function (v: string) {
        return /^[a-zA-Z0-9-_]{4,16}$/.test(v)
      },
      message: (props: { value: any }) =>
        `${props.value} is not a valid room name!`,
    },
  },
  showName: {
    type: String,
  },
  types: {
    type: String,
    required: true,
    enum: ["group", "friend", "public"],
  },
  users: {
    type: [String],
    required: true,
    default: [],
  },
  latestmessage: {
    type: String,
    default: "",
  },
  latestMessageTime: {
    type: Date,
    required: true,
    default: Date.now,
  },
  messages: [
    {
      sender: {
        type: String,
      },
      message: {
        type: String,
      },
      read: {
        type: [String],
      },
      timestamp: { type: Date, default: Date.now },
    },
  ],
  timestamp: { type: Date, default: Date.now },
})
const rooms = mongoose.model("rooms", roomsSchema)
export default rooms
