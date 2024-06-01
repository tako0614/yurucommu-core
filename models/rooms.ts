import mongoose from "mongoose"
export const roomsSchema = new mongoose.Schema({
  uuid: {
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
    default: "",
  },
  types: {
    type: String,
    required: true,
    enum: ["group", "friend", "public"],
  },
  users: {
    type: [
      {
        userid: {
          type: String,
        },
        type: {
          type: String,
          enum: ["local", "other"],
        },
        readedMessageCount: {
          type: Number,
          default: 0,
        },
      },
    ],
    required: true,
    default: [],
  },
  messageCount: {
    type: Number,
    default: 0,
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
  timestamp: { type: Date, default: Date.now },
})
const rooms = mongoose.model("rooms", roomsSchema)
export default rooms
