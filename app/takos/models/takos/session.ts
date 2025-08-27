import mongoose from "mongoose";

const sessionSchema = new mongoose.Schema({
  sessionId: {
    type: String,
    required: true,
    unique: true,
  },
  deviceId: {
    type: String,
    required: true,
    index: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expires: 0 },
  },
  lastDecryptAt: {
    type: Date,
    default: Date.now,
  },
});

const Session = mongoose.models.Session ??
  mongoose.model("Session", sessionSchema);

export default Session;
export { sessionSchema };
