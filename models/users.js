import mongoose from "mongoose";
const usersSchema = new mongoose.Schema({
  userName: {
    type: String,
    required: true,
    unique: true,
    validate: {
      validator: function (v) {
        return /^[a-zA-Z0-9-_]{4,16}$/.test(v);
      },
      message: (props) => `${props.value} is not a valid username!`,
    },
  },
  password: {
    type: String,
    required: true,
    validate: {
      validator: function (v) {
        return /^(?=.*?[a-z])(?=.*?\d)[a-z\d]{8,}$/i.test(v);
      },
      message: (props) => `${props.value} is not a valid password!`,
    },
  },
  mail: {
    type: String,
    required: true,
    unique: true,
    validate: {
      validator: function (v) {
        return /^[\w-]+@[\w-]+\.[a-z]{2,3}$/.test(v);
      },
      message: (props) => `${props.value} is not a valid mail address!`,
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
      validator: function (v) {
        return /^[ぁ-んァ-ン一-龥a-zA-Z0-9]{1,20}$/.test(v);
      },
      message: (props) => `${props.value} is not a valid mail address!`,
    },
  },
  JoiningRoom: {
    type: Array,
    default: [],
  },
  timestamp: { type: Date, default: Date.now },
});
const users = mongoose.model("users", usersSchema);
export default users;
