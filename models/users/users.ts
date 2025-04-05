import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  userName: {
    type: String,
    required: true,
    unique: true,
  },
  nickName: {
    type: String,
  },
  password: {
    type: String,
    required: true,
  },
  salt: {
    type: String,
    required: true,
  },
  icon: {
    type: String,
  },
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
  setup: {
    type: Boolean,
    default: false,
  },
  timestamp: { type: Date, default: Date.now },
  masterKey: {
    type: String,
  },
  description: {
    type: String,
    default: "",
  },
  privateKey: {
    type: String,
  },
});
const User = mongoose.model("users", userSchema);
export { userSchema };
export default User;
