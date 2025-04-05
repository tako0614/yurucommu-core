import mongoose from "mongoose";
export const tempUsersSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    validate: {
      validator: function (v: string) {
        return /^[\w-]+@[\w-]+\.[a-z]{2,3}$/.test(v);
      },
      message: (props: { value: any }) =>
        `${props.value} is not a valid mail address!`,
    },
  },
  checkCode: {
    type: Number,
    required: true,
  },
  checked: {
    type: Boolean,
    default: false,
  },
  missCheck: {
    type: Number,
    default: 0,
  },
  token: {
    type: String,
    required: true,
  },
  timestamp: { type: Date, default: Date.now, expires: 60 * 60 * 24 },
});
const tempUsers = mongoose.model("tempUsers", tempUsersSchema);
export default tempUsers;
