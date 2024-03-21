import { mongoose } from "mongoose";

export const roomsSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    validate: {
      validator: function (v) {
        return /^[a-zA-Z0-9-_]{4,16}$/.test(v);
      },
      message: (props) => `${props.value} is not a valid room name!`,
    },
  },
  users: {
    type: Array,
    required: true,
    default: [],
  },
  timestamp: { type: Date, default: Date.now },
});
const rooms = mongoose.model("rooms", roomsSchema);
export default rooms;
