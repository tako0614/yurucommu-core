import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  userName: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  emailVerified: { type: Boolean, default: false },
  verifyCode: { type: String },
  verifyCodeExpires: { type: Date },
  hashedPassword: { type: String, required: true },
  salt: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

const HostUser = mongoose.models.HostUser ??
  mongoose.model("HostUser", userSchema);

export default HostUser;
export { userSchema };
